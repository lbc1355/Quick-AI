import { describe, expect, it } from 'vitest'
import { classifyToolRuntimeError, createToolFailureExecutionResult } from './toolRuntime'

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
})
