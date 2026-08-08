import type { SessionRunPhase, SessionRunStateNotification } from '../../../shared/types'

export interface SessionGenerationState {
  isCurrentSessionGenerating: boolean
  isOtherSessionGenerating: boolean
}

export interface ActiveSessionGeneration {
  requestId: string | null
  assistantMessageId: string | null
  phase: Exclude<SessionRunPhase, 'idle'>
}

export type SessionGenerationRegistry = ReadonlyMap<string, ActiveSessionGeneration>

export function registerSessionGeneration(
  registry: SessionGenerationRegistry,
  sessionId: string,
  generation: ActiveSessionGeneration
): SessionGenerationRegistry {
  const next = new Map(registry)
  next.set(sessionId, generation)
  return next
}

export function unregisterSessionGeneration(
  registry: SessionGenerationRegistry,
  sessionId: string,
  requestId: string | null
): SessionGenerationRegistry {
  const active = registry.get(sessionId)
  if (!active || active.requestId !== requestId) return registry
  const next = new Map(registry)
  next.delete(sessionId)
  return next
}

export function markSessionFinalizing(
  registry: SessionGenerationRegistry,
  sessionId: string,
  requestId: string
): SessionGenerationRegistry {
  const active = registry.get(sessionId)
  if (!active || active.requestId !== requestId || active.phase === 'finalizing') return registry
  const next = new Map(registry)
  next.set(sessionId, { ...active, phase: 'finalizing' })
  return next
}

/** Apply one authoritative main-process lifecycle event without allowing stale runs to regress it. */
export function applySessionRunState(
  registry: SessionGenerationRegistry,
  state: SessionRunStateNotification
): SessionGenerationRegistry {
  const active = registry.get(state.sessionId)
  if (state.phase === 'generating') {
    if (active) return registry
    return registerSessionGeneration(registry, state.sessionId, {
      requestId: state.requestId,
      assistantMessageId: null,
      phase: 'generating'
    })
  }
  if (state.phase === 'finalizing') {
    return markSessionFinalizing(registry, state.sessionId, state.requestId)
  }
  return unregisterSessionGeneration(registry, state.sessionId, state.requestId)
}

export function getGeneratingSessionIds(registry: SessionGenerationRegistry): ReadonlySet<string> {
  return new Set(
    [...registry.entries()]
      .filter(([, generation]) => generation.phase === 'generating')
      .map(([sessionId]) => sessionId)
  )
}

export function getActiveRequestIds(registry: SessionGenerationRegistry): ReadonlySet<string> {
  return new Set(
    [...registry.values()]
      .filter((generation) => generation.phase === 'generating')
      .map((generation) => generation.requestId)
      .filter((requestId): requestId is string => requestId !== null)
  )
}

/**
 * Derive per-session generation flags from the set of sessions that currently have an active run.
 *
 * Multiple sessions may generate in parallel, so the input is a set of session ids rather than a
 * single global boolean. `isCurrentSessionGenerating` and `isOtherSessionGenerating` can both be
 * true when the current session and at least one other session are running at the same time.
 */
export function getSessionGenerationState(
  generatingSessionIds: ReadonlySet<string>,
  currentSessionId: string
): SessionGenerationState {
  const current = generatingSessionIds.has(currentSessionId)
  const others = generatingSessionIds.size - (current ? 1 : 0)
  return {
    isCurrentSessionGenerating: current,
    isOtherSessionGenerating: others > 0
  }
}
