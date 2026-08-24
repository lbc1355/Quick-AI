import { describe, expect, it, vi } from 'vitest'
import type { SessionPromptAdmission } from '../../shared/types'
import type { BackgroundResultDeliveryDependencies } from './backgroundResultDelivery'
import { deliverBackgroundShellResult } from './backgroundShellDelivery'

const prompt: SessionPromptAdmission = {
  id: 'background-result-admission-shell-1',
  sessionId: 'session-1',
  contextEpoch: 2,
  mode: 'steer',
  status: 'pending',
  runMode: 'agent',
  sourceMessageId: 'background-result-source-shell-1',
  assistantMessageId: 'background-result-assistant-shell-1',
  messages: [{ role: 'user', content: 'result' }],
  createdAt: 1,
  updatedAt: 1
}

const dependencies = (): BackgroundResultDeliveryDependencies => ({
  getContextEpoch: vi.fn(() => 2),
  admit: vi.fn(() => ({ prompt, inserted: true })),
  steer: vi.fn(() => false),
  markRunning: vi.fn(() => true),
  removeSteering: vi.fn(() => true),
  getJob: vi.fn(() => undefined),
  markReported: vi.fn(() => undefined)
})

describe('background shell result delivery', () => {
  it('queues a durable hidden Agent prompt when the parent run is idle', () => {
    const deps = dependencies()
    const send = vi.fn()
    const result = deliverBackgroundShellResult(
      {
        completion: {
          jobId: 'shell-1',
          command: 'npm test',
          status: 'completed',
          output: 'Tests passed',
          resourceId: '11111111111111111111111111111111',
          totalOutputChars: 20_000,
          totalOutputLines: 600,
          outputTruncated: true
        },
        sessionId: 'session-1',
        contextEpoch: 2,
        parentRunId: 'run-1',
        send
      },
      deps
    )

    expect(result.disposition).toBe('queued')
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'background-result-admission-shell-1',
        messages: [
          expect.objectContaining({
            content: expect.stringMatching(/Resource ID:[\s\S]*read_cached_resource/)
          })
        ]
      })
    )
    const content = vi.mocked(deps.admit).mock.calls[0][0].messages[0].content
    expect(content).not.toContain('Tests passed')
    expect(send).toHaveBeenCalledWith(result)
  })
})
