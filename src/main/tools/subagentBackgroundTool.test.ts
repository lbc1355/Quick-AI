import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext, ToolExecutionResult } from './types'

let finishSubagent: (() => void) | undefined

vi.mock('../agent/subagentRunner', () => ({
  runSubagentTask: vi.fn(
    (_request: unknown, ctx: ToolExecutionContext) =>
      new Promise<ToolExecutionResult>((resolve) => {
        ctx.emitEvent?.({
          type: 'subagent_start',
          subagentId: ctx.callId || 'subagent-1',
          parentToolCallId: ctx.callId || '',
          label: 'Research',
          task: 'Inspect',
          maxSteps: 4
        })
        finishSubagent = () => {
          ctx.emitEvent?.({
            type: 'subagent_end',
            subagentId: ctx.callId || 'subagent-1',
            status: 'completed',
            finalAnswer: 'Inspection complete',
            durationMs: 12
          })
          resolve({
            resultForModel: 'Inspection complete',
            resultForUi: { summary: 'complete' }
          })
        }
      })
  )
}))

import { clearBackgroundJobsForTests } from '../agent/backgroundJobManager'
import { subagentTool } from './subagentTool'

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('background subagent tool', () => {
  afterEach(() => {
    finishSubagent = undefined
    clearBackgroundJobsForTests()
  })

  it('returns a running job before the child completes, then publishes its result', async () => {
    const publish = vi.fn()
    const result = await subagentTool.execute(
      { task: 'Inspect', background: true, label: 'Research' },
      {
        reqId: 'run-1',
        callId: 'call-1',
        signal: new AbortController().signal,
        agentModel: { apiUrl: 'https://example.test', apiKey: 'key', model: 'model' },
        host: { publishBackgroundSubagentCompletion: publish }
      }
    )

    expect(result.resultForModel).toContain('Background subagent started')
    expect(finishSubagent).toBeTypeOf('function')
    expect(publish).not.toHaveBeenCalled()

    finishSubagent?.()
    await flush()

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'call-1',
        status: 'completed',
        result: 'Inspection complete'
      })
    )
  })
})
