import { describe, expect, it, vi } from 'vitest'
import { ToolDefinition } from '../tools/types'
import { LoopGuard } from './loopGuard'
import {
  getFetchUrlCallKey,
  prepareToolCalls,
  PreparedToolCallGroups,
  RawToolCall
} from './toolCallPlanning'

function toolCall(name: string, args: Record<string, unknown>, id = `tc-${name}`): RawToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  }
}

const tool = (
  name: string,
  overrides: Partial<Pick<ToolDefinition, 'category' | 'risk' | 'implemented'>> = {}
): ToolDefinition => ({
  name,
  title: name,
  description: `${name} description`,
  tags: [],
  category: overrides.category || 'system',
  risk: overrides.risk || 'low',
  implemented: overrides.implemented ?? true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: async () => ({
    resultForModel: '',
    resultForUi: { title: name }
  })
})

const defaultToolRegistry = {
  get: (name: string): ToolDefinition | undefined =>
    ({
      web_search: tool('web_search', { category: 'web' }),
      fetch_url: tool('fetch_url', { category: 'web' }),
      file_write: tool('file_write', { category: 'file', risk: 'high' }),
      shell: tool('shell', { category: 'shell', risk: 'high' }),
      workspace_add_root: tool('workspace_add_root', { category: 'file', risk: 'high' })
    })[name],
  list: () => []
}

function plan(
  overrides: Partial<Parameters<typeof prepareToolCalls>[0]> = {}
): PreparedToolCallGroups {
  return prepareToolCalls({
    toolCalls: [],
    permissions: {},
    isToolWhitelisted: () => true,
    isToolApproved: () => false,
    isCommandPrefixApproved: () => false,
    hasExecuted: () => false,
    loopGuard: new LoopGuard(),
    toolRegistry: defaultToolRegistry,
    ...overrides
  })
}

describe('getFetchUrlCallKey', () => {
  it('normalizes fetch_url offset and maxChars into a stable key', () => {
    expect(getFetchUrlCallKey({ url: 'https://example.com', offset: 3.7, maxChars: 99999 })).toBe(
      'fetch_url:https://example.com:mode=static:offset=3:maxChars=16000'
    )
    expect(getFetchUrlCallKey({ url: 'https://example.com' })).toBe(
      'fetch_url:https://example.com:mode=static:offset=0:maxChars=default'
    )
  })

  it('returns undefined when no URL is present', () => {
    expect(getFetchUrlCallKey({ offset: 100 })).toBeUndefined()
  })

  it('includes render mode in the fetch_url key', () => {
    expect(getFetchUrlCallKey({ url: 'https://example.com', render: true })).toBe(
      'fetch_url:https://example.com:mode=rendered:offset=0:maxChars=default'
    )
  })
})

describe('prepareToolCalls', () => {
  it('parses calls and classifies allowed valid tools as direct', () => {
    const result = plan({
      toolCalls: [toolCall('web_search', { query: 'quick ai' })]
    })

    expect(result.prepared).toHaveLength(1)
    expect(result.directCalls).toHaveLength(1)
    expect(result.prepared[0]).toMatchObject({
      toolName: 'web_search',
      callId: 'tc-web_search',
      args: { query: 'quick ai' },
      permission: 'allow',
      isValid: true,
      isDeadlock: false,
      classification: 'direct',
      concurrencySafe: true
    })
  })

  it('uses tool metadata to keep mutating and external calls exclusive', () => {
    const mutation = plan({
      toolCalls: [toolCall('file_write', { path: 'src/out.txt', content: 'x' })],
      permissions: { file_write: 'ask' }
    })
    expect(mutation.prepared[0].concurrencySafe).toBe(false)

    const external = tool('external_read')
    external.source = 'mcp'
    const externalPlan = plan({
      toolCalls: [toolCall('external_read', {})],
      toolRegistry: { get: () => external, list: () => [external] }
    })
    expect(externalPlan.prepared[0].concurrencySafe).toBe(false)

    external.isConcurrencySafe = () => true
    const declaredRead = plan({
      toolCalls: [toolCall('external_read', {})],
      toolRegistry: { get: () => external, list: () => [external] }
    })
    expect(declaredRead.prepared[0].concurrencySafe).toBe(true)
  })

  it('blocks unknown or non-whitelisted tools before execution', () => {
    const unknown = plan({
      toolCalls: [toolCall('missing_tool', { foo: 'bar' })]
    })
    expect(unknown.blockedCalls[0]).toMatchObject({
      toolName: 'missing_tool',
      isValid: false,
      classification: 'blocked'
    })

    const notWhitelisted = plan({
      toolCalls: [toolCall('web_search', { query: 'x' })],
      isToolWhitelisted: () => false
    })
    expect(notWhitelisted.blockedCalls[0]).toMatchObject({
      toolName: 'web_search',
      isValid: false,
      classification: 'blocked'
    })
  })

  it('uses an injected registry view for validity checks', () => {
    const result = plan({
      toolCalls: [toolCall('custom_write', { path: 'src/out.txt', content: 'x' })],
      permissions: { custom_write: 'allow' },
      toolRegistry: {
        get: (name) =>
          name === 'custom_write'
            ? {
                name: 'custom_write',
                title: 'Custom Write',
                description: 'Custom write tool',
                tags: [],
                category: 'file',
                risk: 'low',
                implemented: true,
                discoverable: true,
                parameters: {
                  type: 'object',
                  properties: {}
                },
                execute: async () => ({
                  resultForModel: '',
                  resultForUi: { title: 'Custom Write' }
                })
              }
            : undefined,
        list: () => []
      }
    })

    expect(result.directCalls[0]).toMatchObject({
      toolName: 'custom_write',
      isValid: true,
      classification: 'direct'
    })
  })

  it('blocks file writes outside allowed roots', () => {
    const result = plan({
      toolCalls: [toolCall('file_write', { path: '../../outside.txt', content: 'x' })],
      permissions: { file_write: 'allow' }
    })

    expect(result.blockedCalls[0]).toMatchObject({
      toolName: 'file_write',
      permission: 'deny',
      classification: 'blocked'
    })
    expect(result.blockedCalls[0].blockReason).toContain(
      'outside the global workspace and current project root'
    )
  })

  it('escalates project-root file writes from allow to ask', () => {
    const result = plan({
      toolCalls: [toolCall('file_write', { path: 'src/out.txt', content: 'x' })],
      permissions: { file_write: 'allow' },
      projectRoot: 'D:/example/project'
    })

    expect(result.askCalls[0]).toMatchObject({
      toolName: 'file_write',
      permission: 'ask',
      classification: 'ask'
    })
    expect(result.askCalls[0].blockReason).toContain('modify the project root')
  })

  it('does not ask again when a tool or command prefix is already approved', () => {
    const approvedTool = plan({
      toolCalls: [toolCall('file_write', { path: 'src/out.txt', content: 'x' })],
      permissions: { file_write: 'ask' },
      isToolApproved: (toolName) => toolName === 'file_write'
    })
    expect(approvedTool.directCalls[0]).toMatchObject({
      toolName: 'file_write',
      permission: 'allow',
      classification: 'direct'
    })

    const approvedPrefix = plan({
      toolCalls: [toolCall('shell', { command: 'git status' })],
      permissions: { shell: 'ask' },
      isCommandPrefixApproved: (command) => command === 'git status'
    })
    expect(approvedPrefix.directCalls[0]).toMatchObject({
      toolName: 'shell',
      permission: 'allow',
      classification: 'direct'
    })
  })

  it('never auto-allows workspace_add_root via a run approval', () => {
    const result = plan({
      toolCalls: [toolCall('workspace_add_root', { path: 'D:/shared/libs' })],
      permissions: { workspace_add_root: 'allow' },
      isToolApproved: () => true
    })

    expect(result.askCalls[0]).toMatchObject({
      toolName: 'workspace_add_root',
      permission: 'ask',
      classification: 'ask'
    })
  })

  it('detects duplicate fetch_url windows from prior runs and the same turn', () => {
    const prior = plan({
      toolCalls: [toolCall('fetch_url', { url: 'https://example.com', offset: 0 })],
      hasExecuted: (key) =>
        key === 'fetch_url:https://example.com:mode=static:offset=0:maxChars=default'
    })
    expect(prior.directCalls[0]).toMatchObject({
      toolName: 'fetch_url',
      isDeadlock: true,
      classification: 'direct'
    })

    const sameTurn = plan({
      toolCalls: [
        toolCall('fetch_url', { url: 'https://example.com', offset: 0 }, 'tc-fetch-1'),
        toolCall('fetch_url', { url: 'https://example.com', offset: 0 }, 'tc-fetch-2')
      ]
    })
    expect(sameTurn.prepared[0].isDeadlock).toBe(false)
    expect(sameTurn.prepared[1]).toMatchObject({
      callId: 'tc-fetch-2',
      isDeadlock: true,
      classification: 'direct'
    })
  })
  it('allows a rendered fetch_url window after a static fetch_url window', () => {
    const renderedAfterStatic = plan({
      toolCalls: [toolCall('fetch_url', { url: 'https://example.com', render: true })],
      hasExecuted: (key) =>
        key === 'fetch_url:https://example.com:mode=static:offset=0:maxChars=default'
    })
    expect(renderedAfterStatic.prepared[0]).toMatchObject({
      toolName: 'fetch_url',
      isDeadlock: false,
      classification: 'direct'
    })

    const sameTurn = plan({
      toolCalls: [
        toolCall('fetch_url', { url: 'https://example.com' }, 'tc-fetch-static'),
        toolCall('fetch_url', { url: 'https://example.com', render: true }, 'tc-fetch-render'),
        toolCall('fetch_url', { url: 'https://example.com', render: true }, 'tc-fetch-render-2')
      ]
    })
    expect(sameTurn.prepared[0].isDeadlock).toBe(false)
    expect(sameTurn.prepared[1].isDeadlock).toBe(false)
    expect(sameTurn.prepared[2]).toMatchObject({
      callId: 'tc-fetch-render-2',
      isDeadlock: true,
      classification: 'direct'
    })
  })

  it('uses loop guard to block repeated identical calls', () => {
    const loopGuard = new LoopGuard({ identicalCallBlock: 3, failureWarn: 3, failureHalt: 8 })
    const call = toolCall('web_search', { query: 'same' })

    expect(plan({ toolCalls: [call], loopGuard }).prepared[0].loopBlock).toBeUndefined()
    expect(plan({ toolCalls: [call], loopGuard }).prepared[0].loopBlock).toBeUndefined()

    const blocked = plan({ toolCalls: [call], loopGuard }).prepared[0]
    expect(blocked).toMatchObject({
      toolName: 'web_search',
      classification: 'direct'
    })
    expect(blocked.loopBlock).toContain('Loop guard')
  })

  it('keeps invalid JSON arguments contained to that call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = plan({
      toolCalls: [
        {
          id: 'tc-bad-json',
          type: 'function',
          function: { name: 'web_search', arguments: '{not-json' }
        }
      ]
    })

    expect(result.directCalls[0]).toMatchObject({
      callId: 'tc-bad-json',
      args: {},
      classification: 'direct'
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('extracts purpose from arguments and deletes it from args to prevent pollution', () => {
    const result = plan({
      toolCalls: [toolCall('web_search', { query: 'test', purpose: 'searching for tests' })]
    })

    expect(result.prepared).toHaveLength(1)
    expect(result.prepared[0].purpose).toBe('searching for tests')
    expect(result.prepared[0].args).toEqual({ query: 'test' })
  })
})
