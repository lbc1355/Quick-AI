import { describe, expect, it, vi } from 'vitest'
import {
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
})
