import { describe, expect, it, vi } from 'vitest'
import { ToolDefinition } from '../tools/types'
import { LoopGuard } from './loopGuard'
import { executePreparedToolCall } from './preparedToolExecutor'
import { PreparedToolCall } from './toolCallPlanning'

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
    expect(result.markExecutedCallKey).toBe('fetch_url:https://example.com:offset=0:maxChars=default')
    expect(result.events.map((event) => event.type)).toEqual(['tool_result', 'agent_progress'])
    expect(result.action.resultStatus).toBe('success')
  })
})
