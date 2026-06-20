import { describe, expect, it, vi } from 'vitest'
import {
  applyRuntimeToolCallResult,
  classifyToolRuntimeError,
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
    const tool = makeTool(vi.fn(async () => {
      throw new Error('boom')
    }))

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
          errorContent: '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.',
          status: 'ambiguous'
        }),
        errorMessage: 'Agent execution aborted by user.',
        errorContent: '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.',
        response: {
          role: 'tool',
          tool_call_id: 'call-4',
          name: 'file_edit',
          content: '[Ambiguous Side Effect - inspect state before repeating] Agent execution aborted by user.'
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
})
