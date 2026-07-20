import { describe, expect, it, vi } from 'vitest'
import type { SessionPromptAdmission } from '../../shared/types'
import {
  BackgroundSubagentDeliveryDependencies,
  DeliverBackgroundSubagentInput,
  deliverBackgroundSubagentResult
} from './backgroundSubagentDelivery'

const completion = {
  jobId: 'job-1',
  subagentId: 'subagent-1',
  parentToolCallId: 'call-1',
  task: 'Inspect the project',
  label: 'Research',
  status: 'completed' as const,
  result: 'The answer is 42.'
}

const prompt = (): SessionPromptAdmission => ({
  id: 'background-result-admission-job-1',
  sessionId: 'session-1',
  contextEpoch: 3,
  mode: 'steer',
  status: 'pending',
  runMode: 'agent',
  sourceMessageId: 'background-result-source-job-1',
  assistantMessageId: 'background-result-assistant-job-1',
  messages: [{ role: 'user', content: 'result' }],
  createdAt: 1,
  updatedAt: 1
})

const dependencies = (
  overrides: Partial<BackgroundSubagentDeliveryDependencies> = {}
): BackgroundSubagentDeliveryDependencies => ({
  getContextEpoch: vi.fn(() => 3),
  admit: vi.fn(() => ({ prompt: prompt(), inserted: true })),
  steer: vi.fn(() => true),
  markRunning: vi.fn(() => true),
  removeSteering: vi.fn(() => true),
  ...overrides
})

const input = (send = vi.fn()): DeliverBackgroundSubagentInput => ({
  completion,
  sessionId: 'session-1',
  contextEpoch: 3,
  parentRunId: 'run-1',
  parentAssistantMessageId: 'assistant-1',
  send
})

describe('background subagent result delivery', () => {
  it('steers a still-running parent session', () => {
    const deps = dependencies()
    const result = deliverBackgroundSubagentResult(input(), deps)

    expect(result.disposition).toBe('steered')
    expect(deps.steer).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ admissionId: prompt().id, contextEpoch: 3 })
    )
    expect(deps.markRunning).toHaveBeenCalledWith(prompt().id)
  })

  it('leaves the durable result queued when no active run accepts steering', () => {
    const deps = dependencies({ steer: vi.fn(() => false) })
    const result = deliverBackgroundSubagentResult(input(), deps)

    expect(result.disposition).toBe('queued')
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({ runMode: 'agent', contextEpoch: 3 })
    )
  })

  it('rejects a result from an obsolete context epoch before persistence', () => {
    const send = vi.fn()
    const deps = dependencies({ getContextEpoch: vi.fn(() => 4) })
    const result = deliverBackgroundSubagentResult(input(send), deps)

    expect(result.disposition).toBe('stale')
    expect(deps.admit).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ disposition: 'stale' }))
  })
})
