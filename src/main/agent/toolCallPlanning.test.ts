import { describe, expect, it, vi } from 'vitest'
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
    ...overrides
  })
}

describe('getFetchUrlCallKey', () => {
  it('normalizes fetch_url offset and maxChars into a stable key', () => {
    expect(getFetchUrlCallKey({ url: 'https://example.com', offset: 3.7, maxChars: 99999 })).toBe(
      'fetch_url:https://example.com:offset=3:maxChars=16000'
    )
    expect(getFetchUrlCallKey({ url: 'https://example.com' })).toBe(
      'fetch_url:https://example.com:offset=0:maxChars=default'
    )
  })

  it('returns undefined when no URL is present', () => {
    expect(getFetchUrlCallKey({ offset: 100 })).toBeUndefined()
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
      classification: 'direct'
    })
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

  it('detects duplicate fetch_url windows from prior runs and the same turn', () => {
    const prior = plan({
      toolCalls: [toolCall('fetch_url', { url: 'https://example.com', offset: 0 })],
      hasExecuted: (key) => key === 'fetch_url:https://example.com:offset=0:maxChars=default'
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
