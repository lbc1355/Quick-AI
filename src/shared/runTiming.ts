/** Numeric renderer diagnostics carried over IPC, never sent to the provider. */
export interface RendererStartupTiming {
  startedAt: number
  persistedAt: number
  dispatchedAt?: number
  paintWaitMs: number
  persistenceMs: number
}

export type ModelTimingPhase =
  | 'http_request'
  | 'response_headers'
  | 'first_body_chunk'
  | 'first_model_output'
  | 'model_complete'

export interface ModelTimingEvent {
  phase: ModelTimingPhase
  attempt: number
  /** Cumulative time within this HTTP attempt, not a separate stage duration. */
  attemptElapsedMs: number
  /** Includes request preparation and retry backoff before this attempt. */
  callElapsedMs: number
  status?: number
  outcome?: 'success' | 'error'
  outputKind?: 'text' | 'reasoning' | 'tool-call'
}

export interface RunTimingEntry {
  runId: string
  phase: string
  origin: 'renderer' | 'main'
  /** Elapsed time since the renderer began this dispatch, or main entry when unavailable. */
  elapsedMs: number
  /** Duration of a local stage; provider events instead use attemptElapsedMs. */
  durationMs?: number
  step?: number
  details?: Record<string, number | string | boolean>
  model?: ModelTimingEvent
}
