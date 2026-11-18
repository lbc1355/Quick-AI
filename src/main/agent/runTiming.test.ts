import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunTimingLogger } from './runTiming'
import { SessionLogger } from './sessionLogger'

vi.mock('./sessionLogger', () => ({ SessionLogger: { logTiming: vi.fn() } }))

describe('run timing correlation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(SessionLogger.logTiming).mockReset()
  })

  it('keeps concurrent run ids and renderer origins separate', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const a = createRunTimingLogger('session-a', 'run-a', {
      startedAt: 1000,
      persistedAt: 1500,
      dispatchedAt: 1800,
      paintWaitMs: 16,
      persistenceMs: 484
    })
    const b = createRunTimingLogger('session-b', 'run-b')
    a.record('snapshot_capture', 80)
    b.record('agent_prepare', 20)
    expect(SessionLogger.logTiming).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({
        runId: 'run-a',
        origin: 'renderer',
        phase: 'renderer_startup',
        durationMs: 500,
        details: { paintWaitMs: 16, persistenceMs: 484, ipcWaitMs: 200 }
      })
    )
    expect(SessionLogger.logTiming).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({
        runId: 'run-b',
        origin: 'main',
        phase: 'agent_prepare',
        durationMs: 20
      })
    )
  })

  it('does not make logging a prerequisite for a run', () => {
    vi.mocked(SessionLogger.logTiming).mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => {
      const timings = createRunTimingLogger('s', 'r')
      timings.record('file_snapshot', 200)
      timings.model(1)({ phase: 'http_request', attempt: 1, attemptElapsedMs: 0, callElapsedMs: 5 })
    }).not.toThrow()
  })
})
