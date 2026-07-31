import type { Session } from '../../../../shared/types'
import { getSessionContextEpoch } from '../../../../shared/contextEpoch'

export interface EpochScopedNotification {
  sessionId: string
  contextEpoch: number
}

/**
 * Apply a background result to its originating session, or drop it.
 *
 * Background work outlives the turn that started it, so by the time a result arrives the user may
 * have cleared or compacted the conversation. The session's context epoch is bumped on every such
 * reset, so a mismatch means this result belongs to a conversation that no longer exists — merging
 * it would splice stale output into unrelated history.
 *
 * Returns `undefined` when the notification should be discarded, so callers can skip the state
 * write entirely rather than re-rendering with an unchanged list.
 */
export const applyEpochScopedNotification = <T extends EpochScopedNotification>(
  sessions: Session[],
  notification: T,
  apply: (session: Session, notification: T) => Session
): Session[] | undefined => {
  const current = sessions.find((session) => session.id === notification.sessionId)
  if (!current || getSessionContextEpoch(current) !== notification.contextEpoch) return undefined
  return sessions.map((session) =>
    session.id === notification.sessionId ? apply(session, notification) : session
  )
}

/** Fold a batch of queued events, dropping any whose epoch no longer matches. */
export const applyEpochScopedNotifications = <T extends EpochScopedNotification>(
  sessions: Session[],
  notifications: T[],
  apply: (session: Session, notification: T) => Session
): { sessions: Session[]; changed: boolean } => {
  let next = sessions
  let changed = false
  for (const notification of notifications) {
    const applied = applyEpochScopedNotification(next, notification, (session, item) => {
      const updated = apply(session, item)
      changed = changed || updated !== session
      return updated
    })
    if (applied) next = applied
  }
  return { sessions: next, changed }
}

/**
 * A background result that was queued rather than steered needs a run to carry it. Sessions run
 * independently, so drain the originating session as soon as that session is idle.
 */
export const shouldDrainAfterNotification = (
  notification: EpochScopedNotification & { disposition?: string },
  isSessionGenerating: boolean
): boolean => notification.disposition === 'queued' && !isSessionGenerating
