import type { ModelTimingEvent } from '../../shared/runTiming'

/** Bounded markers per attempt: never log individual deltas or request/response contents. */
export function createModelTimingReporter(
  callback?: (event: ModelTimingEvent) => void,
  now: () => number = () => performance.now()
): { startAttempt: () => ModelAttemptTiming } {
  const callStart = now()
  let attempt = 0
  return {
    startAttempt: () => {
      attempt += 1
      const attemptNumber = attempt
      const attemptStart = now()
      let bodySeen = false
      let outputSeen = false
      let completed = false
      const emit = (
        phase: ModelTimingEvent['phase'],
        extra: Partial<ModelTimingEvent> = {}
      ): void => {
        if (!callback) return
        const current = now()
        try {
          callback({
            phase,
            attempt: attemptNumber,
            attemptElapsedMs: Math.max(0, current - attemptStart),
            callElapsedMs: Math.max(0, current - callStart),
            ...extra
          })
        } catch {
          // Diagnostics must never interrupt a provider request.
        }
      }
      emit('http_request')
      return {
        headers: (status) => emit('response_headers', { status }),
        bodyChunk: () => {
          if (bodySeen) return
          bodySeen = true
          emit('first_body_chunk')
        },
        output: (outputKind) => {
          if (outputSeen) return
          outputSeen = true
          emit('first_model_output', { outputKind })
        },
        complete: (outcome) => {
          if (completed) return
          completed = true
          emit('model_complete', { outcome })
        }
      }
    }
  }
}

export interface ModelAttemptTiming {
  headers: (status: number) => void
  bodyChunk: () => void
  output: (kind: NonNullable<ModelTimingEvent['outputKind']>) => void
  complete: (outcome: NonNullable<ModelTimingEvent['outcome']>) => void
}
