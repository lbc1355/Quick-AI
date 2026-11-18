import type {
  ModelTimingEvent,
  RendererStartupTiming,
  RunTimingEntry
} from '../../shared/runTiming'
import { SessionLogger } from './sessionLogger'

export function createRunTimingLogger(
  sessionId: string,
  runId: string,
  renderer?: RendererStartupTiming
): {
  record: (phase: string, durationMs?: number, details?: RunTimingEntry['details']) => void
  model: (step?: number) => (event: ModelTimingEvent) => void
} {
  const mainStart = performance.now()
  const receivedAt = Date.now()
  const validRenderer =
    renderer &&
    [renderer.startedAt, renderer.persistedAt, renderer.paintWaitMs, renderer.persistenceMs].every(
      Number.isFinite
    ) &&
    renderer.startedAt <= renderer.persistedAt &&
    renderer.persistedAt <= receivedAt
      ? renderer
      : undefined
  const rendererElapsed = validRenderer ? receivedAt - validRenderer.startedAt : 0
  const write = (entry: Omit<RunTimingEntry, 'runId' | 'elapsedMs' | 'origin'>): void => {
    try {
      SessionLogger.logTiming(sessionId, {
        runId,
        origin: validRenderer ? 'renderer' : 'main',
        elapsedMs: rendererElapsed + performance.now() - mainStart,
        ...entry
      })
    } catch {
      // Also tolerate disabled/unavailable loggers; measurements are never run prerequisites.
    }
  }
  if (validRenderer) {
    write({
      phase: 'renderer_startup',
      durationMs: validRenderer.persistedAt - validRenderer.startedAt,
      details: {
        paintWaitMs: validRenderer.paintWaitMs,
        persistenceMs: validRenderer.persistenceMs,
        ...(Number.isFinite(validRenderer.dispatchedAt)
          ? { ipcWaitMs: Math.max(0, receivedAt - validRenderer.dispatchedAt!) }
          : {})
      }
    })
  }
  write({ phase: 'main_received', durationMs: 0 })
  return {
    record: (phase, durationMs, details) => write({ phase, durationMs, details }),
    model: (step) => (model) => write({ phase: model.phase, step, model })
  }
}
