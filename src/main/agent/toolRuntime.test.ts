import { describe, expect, it, vi } from 'vitest'
import {
  applyRuntimeToolCallResult,
  classifyToolRuntimeError,
  createSkippedToolCallResult,
  createToolFailureExecutionResult,
  executeRuntimeToolCall
} from './toolRuntime'
import { ToolDefinition } from '../tools/types'

const retryPolicy = {
  maxRetries: 0,
  baseDelayMs: 1,
  maxDelayMs: 1,
  retryableErrors: new Set<string>()
}

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

const rejectWhenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    const rejectAbort = (): void => reject(signal.reason || new Error('aborted'))
    if (signal.aborted) rejectAbort()
    else signal.addEventListener('abort', rejectAbort, { once: true })
  })

describe('tool runtime helpers', () => {
  it('classifies interrupted side-effecting tools as ambiguous', () => {
    const controller = new AbortController()
    controller.abort()

    const classification = classifyToolRuntimeError(new Error('Agent execution aborted'), {
      signal: controller.signal,
      isSideEffecting: true,
      retryable: false
    })

    expect(classification.status).toBe('ambiguous')
    expect(classification.category).toContain('Ambiguous Side Effect')
    expect(classification.interrupted).toBe(true)
  })

  it('classifies retryable errors as transient', () => {
    const classification = classifyToolRuntimeError(new Error('socket hang up'), {
      isSideEffecting: false,
      retryable: true
    })

    expect(classification.status).toBe('error')
    expect(classification.category).toContain('Transient Error')
  })

  it('builds failure results with model observation and UI details', () => {
    const result = createToolFailureExecutionResult({
      toolName: 'file_edit',
      args: { path: 'src/main.ts', oldString: 'before' },
      errorMessage: 'String not found',
      errorContent: '[Permanent Error - do not retry this action] String not found',
      status: 'error'
    })

    expect(result.resultForModel).toContain('Permanent Error')
    expect(result.resultForUi.title).toBe('Tool Failed: file_edit')
    expect(result.resultForUi.summary).toContain('String not found')
    expect(result.resultForUi.details).toContain('"path": "src/main.ts"')
    expect(result.resultForUi.details).toContain('Model Observation')
  })

  it('executes a tool and returns a normalized runtime result', async () => {
    const tool = makeTool(
      vi.fn(async () => ({
        resultForModel: 'runtime output',
        resultForUi: {
          title: 'Runtime Tool',
          summary: 'ok'
        },
        modelAttachments: [
          {
            type: 'image_url' as const,
            image_url: { url: 'data:image/png;base64,abc' }
          }
        ]
      }))
    )

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-1',
      args: { value: 1 },
      tool,
      context: {
        reqId: 'req-1',
        signal: new AbortController().signal
      },
      retryPolicy,
      isSideEffecting: false
    })

    expect(result.status).toBe('success')
    expect(result.response).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'test_tool',
      content: 'runtime output'
    })
    expect(result.executionResult.resultForUi.details).toBe('runtime output')
    expect(result.modelAttachments).toHaveLength(1)
  })

  it('converts thrown tool errors into failure runtime results', async () => {
    const tool = makeTool(
      vi.fn(async () => {
        throw new Error('boom')
      })
    )

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-2',
      args: { path: 'missing.ts' },
      tool,
      context: {
        reqId: 'req-1',
        signal: new AbortController().signal
      },
      retryPolicy,
      isSideEffecting: false
    })

    expect(result.status).toBe('error')
    expect(result.errorMessage).toBe('boom')
    expect(result.response.content).toContain('Permanent Error')
    expect(result.executionResult.resultForUi.title).toBe('Tool Failed: test_tool')
    expect(result.executionResult.resultForUi.details).toContain('"path": "missing.ts"')
  })

  it('classifies a read-only tool deadline as timeout', async () => {
    const tool = {
      ...makeTool(vi.fn((_args, ctx) => rejectWhenAborted(ctx.signal))),
      timeoutMs: 10
    }

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-timeout',
      args: {},
      tool,
      context: { reqId: 'req-1', signal: new AbortController().signal },
      retryPolicy,
      isSideEffecting: false
    })

    expect(result.status).toBe('timeout')
    expect(result.response.content).toContain('Tool Timeout')
    expect(result.errorMessage).toContain('timed out after 10ms')
  })

  it('classifies a side-effecting tool deadline as ambiguous', async () => {
    const tool = {
      ...makeTool(vi.fn((_args, ctx) => rejectWhenAborted(ctx.signal))),
      timeoutMs: 10
    }

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-ambiguous-timeout',
      args: {},
      tool,
      context: { reqId: 'req-1', signal: new AbortController().signal },
      retryPolicy,
      isSideEffecting: true
    })

    expect(result.status).toBe('ambiguous')
    expect(result.response.content).toContain('inspect state before repeating')
  })

  it('classifies caller cancellation separately from timeout', async () => {
    const controller = new AbortController()
    const tool = makeTool(vi.fn((_args, ctx) => rejectWhenAborted(ctx.signal)))
    const pending = executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-cancelled',
      args: {},
      tool,
      context: { reqId: 'req-1', signal: controller.signal },
      retryPolicy,
      isSideEffecting: false
    })

    controller.abort()
    const result = await pending

    expect(result.status).toBe('cancelled')
    expect(result.response.content).toContain('Tool Cancelled')
  })

  it('does not mark a side effect ambiguous when cancellation prevented it from starting', async () => {
    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn(async () => ({
      resultForModel: 'never',
      resultForUi: { title: 'never' }
    }))

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-cancelled-before-start',
      args: {},
      tool: makeTool(execute),
      context: { reqId: 'req-1', signal: controller.signal },
      retryPolicy,
      isSideEffecting: true
    })

    expect(result.status).toBe('cancelled')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not retry a side-effecting tool after a retryable error', async () => {
    const execute = vi.fn(async () => {
      throw new Error('network error after request dispatch')
    })
    const tool = makeTool(execute)

    const result = await executeRuntimeToolCall({
      toolName: 'test_tool',
      callId: 'call-no-retry',
      args: {},
      tool,
      context: { reqId: 'req-1', signal: new AbortController().signal },
      retryPolicy: {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        retryableErrors: new Set(['network error'])
      },
      isSideEffecting: true
    })

    expect(result.status).toBe('error')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('applies successful runtime results into response, events, and output-store requests', () => {
    const loopGuard = {
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    }

    const result = applyRuntimeToolCallResult({
      runtimeResult: {
        status: 'success',
        executionResult: {
          resultForModel: 'large runtime output',
          resultForUi: {
            title: 'Runtime Tool',
            summary: 'ok'
          }
        },
        response: {
          role: 'tool',
          tool_call_id: 'call-3',
          name: 'fetch_url',
          content: 'large runtime output'
        }
      },
      toolName: 'fetch_url',
      callId: 'call-3',
      args: { url: 'https://example.com' },
      loopGuard,
      outputSpilloverThreshold: 10,
      fetchUrlCallKey: 'fetch:https://example.com',
      step: 2,
      maxSteps: 8,
      stepId: 'step-2',
      activeTools: ['fetch_url'],
      now: 123
    })

    expect(loopGuard.recordSuccess).toHaveBeenCalledWith('fetch_url')
    expect(loopGuard.recordFailure).not.toHaveBeenCalled()
    expect(result.response.content).toBe('large runtime output')
    expect(result.action).toMatchObject({
      resultStatus: 'success',
      resultContent: 'large runtime output'
    })
    expect(result.markExecutedCallKey).toBe('fetch:https://example.com')
    expect(result.outputStore).toEqual({
      callId: 'call-3',
      content: 'large runtime output',
      activateToolName: 'read_tool_output'
    })
    expect(result.events).toEqual([
      {
        type: 'tool_result',
        callId: 'call-3',
        result: {
          title: 'Runtime Tool',
          summary: 'ok'
        },
        step: 2,
        stepId: 'step-2'
      },
      {
        type: 'agent_progress',
        step: 2,
        maxSteps: 8,
        stepId: 'step-2',
        activeTools: ['fetch_url', 'read_tool_output'],
        message: 'Completed fetch_url'
      }
    ])
  })

  it('applies failed runtime results with loop guard notes and tool error ordering', () => {
    const loopGuard = {
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(() => ({ level: 'warn' as const, count: 3 }))
    }

    const result = applyRuntimeToolCallResult({
      runtimeResult: {
        status: 'ambiguous',
        executionResult: createToolFailureExecutionResult({
          toolName: 'file_edit',
          args: { path: 'src/main.ts' },
          errorMessage: 'Agent execution aborted by user.',
          errorContent:
            '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.',
          status: 'ambiguous'
        }),
        errorMessage: 'Agent execution aborted by user.',
        errorContent:
          '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.',
        response: {
          role: 'tool',
          tool_call_id: 'call-4',
          name: 'file_edit',
          content:
            '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.'
        }
      },
      toolName: 'file_edit',
      callId: 'call-4',
      args: { path: 'src/main.ts' },
      loopGuard,
      outputSpilloverThreshold: 100,
      step: 3,
      maxSteps: 8,
      stepId: 'step-3',
      activeTools: ['file_edit'],
      now: 456
    })

    expect(loopGuard.recordSuccess).not.toHaveBeenCalled()
    expect(loopGuard.recordFailure).toHaveBeenCalledWith('file_edit')
    expect(result.action.resultStatus).toBe('ambiguous')
    expect(result.action.resultContent).toContain('failed 3 times in a row')
    expect(result.response.content).toContain('try a different approach or tool')
    expect(result.ambiguousAction).toEqual({
      callId: 'call-4',
      toolName: 'file_edit',
      args: { path: 'src/main.ts' },
      reason: result.action.resultContent,
      timestamp: 456
    })
    expect(result.events.map((event) => event.type)).toEqual(['tool_result', 'tool_error'])
    expect(result.events[1]).toMatchObject({
      type: 'tool_error',
      callId: 'call-4',
      error: 'Agent execution aborted by user.',
      step: 3,
      stepId: 'step-3'
    })
  })

  it('creates skipped denied tool results with a denied tool_call event when requested', () => {
    const result = createSkippedToolCallResult({
      toolName: 'missing_tool',
      callId: 'call-5',
      args: { value: 1 },
      modelContent: 'Error: Tool execution blocked',
      toolError: 'Tool execution blocked',
      actionStatus: 'denied',
      step: 4,
      stepId: 'step-4',
      deniedToolCall: {
        purpose: 'test denied call'
      }
    })

    expect(result.response).toEqual({
      role: 'tool',
      tool_call_id: 'call-5',
      name: 'missing_tool',
      content: 'Error: Tool execution blocked'
    })
    expect(result.action).toEqual({
      resultStatus: 'denied',
      resultContent: 'Error: Tool execution blocked'
    })
    expect(result.events).toEqual([
      {
        type: 'tool_call',
        callId: 'call-5',
        toolName: 'missing_tool',
        args: { value: 1 },
        purpose: 'test denied call',
        permissionState: 'denied',
        step: 4,
        stepId: 'step-4'
      },
      {
        type: 'tool_error',
        callId: 'call-5',
        error: 'Tool execution blocked',
        step: 4,
        stepId: 'step-4'
      }
    ])
  })

  it('creates skipped blocked tool results without emitting a synthetic tool_call', () => {
    const result = createSkippedToolCallResult({
      toolName: 'fetch_url',
      callId: 'call-6',
      args: { url: 'https://example.com' },
      modelContent: 'Warning: fetch limit reached',
      toolError: 'Warning: fetch limit reached',
      actionStatus: 'blocked',
      step: 5,
      stepId: 'step-5'
    })

    expect(result.action.resultStatus).toBe('blocked')
    expect(result.response.content).toBe('Warning: fetch limit reached')
    expect(result.events.map((event) => event.type)).toEqual(['tool_error'])
  })
})
