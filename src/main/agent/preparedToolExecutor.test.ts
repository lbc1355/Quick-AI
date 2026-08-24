import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolDefinition } from '../tools/types'
import { LoopGuard } from './loopGuard'
import { executePreparedToolCall } from './preparedToolExecutor'
import { persistToolOutputResource } from './toolOutputResource'
import { PreparedToolCall } from './toolCallPlanning'

vi.mock('./toolOutputResource', () => ({
  getToolOutputProjectionMode: (toolName: string) =>
    toolName === 'shell' || toolName.startsWith('shell_background_') ? 'head_tail' : 'head',
  persistToolOutputResource: vi.fn()
}))

const retryPolicy = {
  maxRetries: 0,
  baseDelayMs: 1,
  maxDelayMs: 1,
  retryableErrors: new Set<string>()
}

const makePrep = (overrides: Partial<PreparedToolCall> = {}): PreparedToolCall => ({
  index: 0,
  toolCall: {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'test_tool',
      arguments: '{}'
    }
  },
  toolName: 'test_tool',
  callId: 'call-1',
  args: {},
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification: 'direct',
  ...overrides
})

const makeTool = (execute: ToolDefinition['execute']): ToolDefinition => ({
  name: 'test_tool',
  title: 'Test Tool',
  description: 'Test tool',
  tags: [],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {}
  },
  execute
})

describe('executePreparedToolCall', () => {
  beforeEach(() => {
    vi.mocked(persistToolOutputResource).mockReset()
  })
  it('returns denied result for invalid prepared calls without executing a tool', async () => {
    const result = await executePreparedToolCall({
      prep: makePrep({
        isValid: false,
        blockReason: 'Tool blocked by policy.',
        purpose: 'try blocked tool'
      }),
      tool: undefined,
      isApproved: true,
      reqId: 'req-1',
      step: 2,
      maxSteps: 8,
      stepId: 'step-2',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 1000,
      activeTools: [],
      fetchUrlBudget: { count: 0, max: 3 }
    })

    expect(result.response).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'test_tool',
      content: 'Error: Tool blocked by policy.'
    })
    expect(result.action).toEqual({
      resultStatus: 'denied',
      resultContent: 'Error: Tool blocked by policy.'
    })
    expect(result.events.map((event) => event.type)).toEqual(['tool_call', 'tool_error'])
    expect(result.events[0]).toMatchObject({
      type: 'tool_call',
      permissionState: 'denied',
      purpose: 'try blocked tool'
    })
  })

  it('blocks fetch_url when the per-run fetch budget is exhausted', async () => {
    const tool = makeTool(
      vi.fn(async () => ({
        resultForModel: 'should not run',
        resultForUi: {
          title: 'Should Not Run'
        }
      }))
    )
    const budget = { count: 2, max: 2 }

    const result = await executePreparedToolCall({
      prep: makePrep({
        toolName: 'fetch_url',
        callId: 'call-fetch',
        args: { url: 'https://example.com' }
      }),
      tool,
      isApproved: true,
      reqId: 'req-1',
      step: 1,
      maxSteps: 8,
      stepId: 'step-1',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 1000,
      activeTools: [],
      fetchUrlBudget: budget
    })

    expect(tool.execute).not.toHaveBeenCalled()
    expect(budget.count).toBe(2)
    expect(result.action.resultStatus).toBe('blocked')
    expect(result.response.content).toContain('maximum fetch limit of 2')
  })

  it('executes approved tools, streams output deltas, and returns runtime side effects', async () => {
    const outputEvents: unknown[] = []
    const tool = makeTool(
      vi.fn(async (_args, ctx) => {
        ctx.emitOutput?.({ stream: 'stdout', content: 'line 1' })
        return {
          resultForModel: 'runtime output',
          resultForUi: {
            title: 'Runtime Tool',
            summary: 'ok'
          }
        }
      })
    )

    const result = await executePreparedToolCall({
      prep: makePrep({
        toolName: 'fetch_url',
        callId: 'call-fetch',
        args: { url: 'https://example.com' }
      }),
      tool,
      isApproved: true,
      reqId: 'req-1',
      step: 3,
      maxSteps: 8,
      stepId: 'step-3',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 1000,
      activeTools: ['fetch_url'],
      fetchUrlBudget: { count: 0, max: 3 },
      emitEvent: (event) => outputEvents.push(event)
    })

    expect(tool.execute).toHaveBeenCalledTimes(1)
    expect(outputEvents).toEqual([
      {
        type: 'tool_output_delta',
        callId: 'call-fetch',
        stream: 'stdout',
        content: 'line 1',
        replace: undefined,
        step: 3,
        stepId: 'step-3'
      }
    ])
    expect(result.response.content).toBe('runtime output')
    expect(result.markExecutedCallKey).toBe(
      'fetch_url:https://example.com:mode=static:offset=0:maxChars=default'
    )
    expect(result.events.map((event) => event.type)).toEqual(['tool_result', 'agent_progress'])
    expect(result.action.resultStatus).toBe('success')
  })
  it('does not resource-wrap fetch_url output because fetch_url already has maxChars and resource paging', async () => {
    const fullOutput = 'fetch-url-output-'.repeat(200)
    const tool = makeTool(
      vi.fn(async () => ({
        resultForModel: fullOutput,
        resultForUi: {
          title: 'Fetched URL',
          summary: 'windowed output'
        }
      }))
    )

    const result = await executePreparedToolCall({
      prep: makePrep({
        toolName: 'fetch_url',
        callId: 'call-fetch-large',
        args: { url: 'https://example.com' }
      }),
      tool,
      isApproved: true,
      reqId: 'req-fetch-large',
      step: 4,
      maxSteps: 8,
      stepId: 'step-4',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 10,
      activeTools: ['fetch_url'],
      fetchUrlBudget: { count: 0, max: 3 }
    })

    expect(persistToolOutputResource).not.toHaveBeenCalled()
    expect(result.response.content).toBe(fullOutput)
    expect(result.outputStore).toEqual({
      callId: 'call-fetch-large',
      content: fullOutput,
      activateToolName: 'read_tool_output'
    })
  })

  it('stores oversized tool output in the resource cache and returns a bounded preview', async () => {
    const outputEvents: unknown[] = []
    const fullOutput = '0123456789tail-content'
    const tool = makeTool(
      vi.fn(async () => ({
        resultForModel: fullOutput,
        resultForUi: {
          title: 'Large Tool',
          summary: 'large output'
        }
      }))
    )

    vi.mocked(persistToolOutputResource).mockResolvedValue({
      resourceId: 'abcdef1234567890abcdef1234567890',
      previewEndOffset: 10,
      nextOffset: 10,
      contentForModel:
        'Tool output exceeded the model-visible limit and was saved to the resource cache.\n' +
        'Tool: shell\n' +
        'Resource ID: abcdef1234567890abcdef1234567890\n' +
        'Total chars: 22\n' +
        'Returned offset: 0-10\n' +
        'Next offset: 10\n' +
        'To continue reading, call read_cached_resource with {"resourceId":"abcdef1234567890abcdef1234567890","offset":10}.\n' +
        'Head preview:\n0123456789'
    })

    const result = await executePreparedToolCall({
      prep: makePrep({
        toolName: 'shell',
        callId: 'call-large-cache',
        args: { command: 'demo' }
      }),
      tool,
      isApproved: true,
      reqId: 'req-large-cache',
      step: 4,
      maxSteps: 8,
      stepId: 'step-4',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 10,
      activeTools: ['shell'],
      fetchUrlBudget: { count: 0, max: 3 },
      emitEvent: (event) => outputEvents.push(event)
    })

    expect(result.response.content).toContain('Tool output exceeded the model-visible limit')
    expect(result.response.content).toContain('Returned offset: 0-10')
    expect(result.response.content).toContain('Next offset: 10')
    expect(result.response.content).toContain('"offset":10')
    expect(result.response.content).toContain('Head preview:\n0123456789')
    expect(result.response.content).not.toContain('tail-content')
    expect(result.action.resultContent).toBe(result.response.content)
    expect(result.events[0]).toMatchObject({
      type: 'tool_result',
      result: {
        summary: 'large output · large output cached',
        details: expect.stringContaining('Resource ID: abcdef1234567890abcdef1234567890')
      }
    })
    expect(result.outputStore?.content).toBe(fullOutput)
    expect(result.outputStore?.activateToolNames).toEqual([
      'read_tool_output',
      'list_cached_resources',
      'read_cached_resource',
      'search_cached_resource'
    ])
    expect(result.events[1]).toMatchObject({
      type: 'agent_progress',
      activeTools: [
        'shell',
        'read_tool_output',
        'list_cached_resources',
        'read_cached_resource',
        'search_cached_resource'
      ]
    })

    expect(persistToolOutputResource).toHaveBeenCalledWith(
      expect.objectContaining({
        reqId: 'req-large-cache',
        callId: 'call-large-cache',
        toolName: 'shell',
        content: fullOutput,
        previewBytes: 10,
        projectionMode: 'head_tail'
      })
    )
    expect(outputEvents).toEqual([])
  })

  it('spills multibyte tool output according to UTF-8 bytes', async () => {
    const fullOutput = '中文'
    const tool = makeTool(
      vi.fn(async () => ({
        resultForModel: fullOutput,
        resultForUi: { title: 'UTF-8 Tool' }
      }))
    )
    vi.mocked(persistToolOutputResource).mockResolvedValue(undefined)

    const result = await executePreparedToolCall({
      prep: makePrep(),
      tool,
      isApproved: true,
      reqId: 'req-utf8',
      step: 1,
      maxSteps: 8,
      stepId: 'step-1',
      signal: new AbortController().signal,
      retryPolicy,
      isSideEffecting: false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 4,
      activeTools: ['test_tool'],
      fetchUrlBudget: { count: 0, max: 3 }
    })

    expect(persistToolOutputResource).toHaveBeenCalledWith(
      expect.objectContaining({ content: fullOutput, previewBytes: 4 })
    )
    expect(result.outputStore).toMatchObject({ content: fullOutput })
  })
})
