import type { ClearSessionCachesPayload, Session, SessionResource } from '../../../../shared/types'
import { computeOrphanResourceIds, computeResourcePrune } from '../../hooks/useSessions'
import { commitSessionClearDraft, commitSessionRevert } from './sessionRevertService'

/**
 * Copy a session list one level into the messages so a dispatch can mutate its working copy
 * without writing through to the rendered state.
 */
export const cloneSessionsDeep = (sessions: Session[]): Session[] =>
  sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => ({ ...message }))
  }))

/** Clone only the session that a foreground action is about to mutate. */
export const cloneSessionInSnapshot = (sessions: Session[], sessionId: string): Session[] =>
  sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          messages: session.messages.map((message) => ({ ...message }))
        }
      : session
  )

export const touchSessionInSnapshot = (
  sessions: Session[],
  sessionId: string,
  timestamp: number
): Session[] =>
  sessions.map((session) =>
    session.id === sessionId ? { ...session, lastActiveTime: timestamp } : session
  )

export const replaceSessionInSnapshot = (sessions: Session[], session: Session): Session[] =>
  sessions.map((candidate) => (candidate.id === session.id ? session : candidate))

export interface RemovedRunCleanupPlan {
  /** Resources still referenced by a surviving run, to write back onto the session. */
  keptResources: SessionResource[]
  /** Disk cleanup the caller should fire, absent when nothing became collectable. */
  cacheCleanup?: ClearSessionCachesPayload
}

/**
 * Plan the cleanup for runs dropped by an in-place edit.
 *
 * Editing a message discards every run after it. Their action logs always go, but a resource only
 * becomes deletable once no surviving run in *any* session still points at it — the resource cache
 * is shared, so pruning per-session would delete rows a sibling branch is still reading.
 */
export const planRemovedRunCleanup = (
  sessions: Session[],
  session: Session,
  removedRunIds: string[]
): RemovedRunCleanupPlan => {
  const otherSessions = sessions.filter((candidate) => candidate.id !== session.id)
  const { keptResources, deletableIds } = computeResourcePrune(
    session,
    otherSessions,
    removedRunIds
  )
  if (removedRunIds.length === 0 && deletableIds.length === 0) return { keptResources }
  return {
    keptResources,
    cacheCleanup: {
      sessionIds: [],
      resourceIds: deletableIds,
      partialActions: [{ sessionId: session.id, runIds: removedRunIds }]
    }
  }
}

export interface StagedRevertCommitPlan {
  /** The session with its staged rollback dropped. Identical to the input when none was staged. */
  session: Session
  /** The snapshot with the committed session substituted in. */
  sessions: Session[]
  /** Disk cleanup the caller should fire, absent when the commit freed nothing. */
  cacheCleanup?: ClearSessionCachesPayload
}

/**
 * Commit a staged rollback (agent-run revert and/or /clear undo): sending a new message discards
 * the "restore"/"撤销" affordance, so the reverted runs / cleared resources — and any resources
 * only they referenced — become collectable.
 *
 * Pure — the caller owns both the state write and the `clearSessionCaches` IPC call. Resources are
 * pruned against the *original* (pre-revert / pre-clear) resource lists, because that is what the
 * discarded runs actually referenced.
 */
export const planStagedRevertCommit = (
  sessions: Session[],
  sourceSession: Session
): StagedRevertCommitPlan => {
  if (!sourceSession.revert && !sourceSession.clearedDraft) {
    return { session: sourceSession, sessions }
  }

  const committed = sourceSession.revert
    ? commitSessionRevert(sourceSession)
    : {
        session: sourceSession,
        committedRunIds: [] as string[],
        originalResources: undefined as SessionResource[] | undefined
      }
  const clearCommitted = committed.session.clearedDraft
    ? commitSessionClearDraft(committed.session)
    : { session: committed.session, originalResources: undefined as SessionResource[] | undefined }

  const nextSessions = replaceSessionInSnapshot(sessions, clearCommitted.session)
  const otherSessions = nextSessions.filter((session) => session.id !== sourceSession.id)

  // Revert-prune is run-aware over the reverted runs' resources; a clear discards every draft
  // resource no surviving session still references.
  const revertDeletable = sourceSession.revert
    ? computeResourcePrune(
        { ...clearCommitted.session, resources: committed.originalResources },
        otherSessions,
        committed.committedRunIds
      ).deletableIds
    : []
  const clearDeletable = clearCommitted.originalResources
    ? computeOrphanResourceIds(
        { ...clearCommitted.session, resources: clearCommitted.originalResources },
        otherSessions
      )
    : []

  const deletableIds = Array.from(new Set([...revertDeletable, ...clearDeletable]))
  const hasCleanup = committed.committedRunIds.length > 0 || deletableIds.length > 0
  return {
    session: clearCommitted.session,
    sessions: nextSessions,
    ...(hasCleanup
      ? {
          cacheCleanup: {
            sessionIds: [],
            resourceIds: deletableIds,
            ...(committed.committedRunIds.length > 0
              ? {
                  partialActions: [
                    { sessionId: sourceSession.id, runIds: committed.committedRunIds }
                  ]
                }
              : {})
          }
        }
      : {})
  }
}

export interface CacheCleanupAfterPersistOptions {
  /** The durable write that commits the staged rollback (drops `revert` on disk). */
  persist: () => Promise<void>
  /** Disk cleanup the commit freed up; absent → nothing to fire. */
  cacheCleanup?: ClearSessionCachesPayload
  /** How to clear the caches (the `window.api.clearSessionCaches` IPC). */
  clearCaches: (payload: ClearSessionCachesPayload) => Promise<unknown>
}

/**
 * Fire a staged-rollback commit's cache cleanup only once the commit has durably persisted.
 *
 * Ordering contract: clearing the caches before the on-disk session drops `revert` leaves a revert
 * plan pointing at deleted rows — restore breaks if the app quits in the window between. Persist
 * first; when the write fails the on-disk revert stays fully intact and the cleanup is skipped
 * (cache residue is collectable garbage). Cleanup errors never surface: the commit already
 * succeeded and a leftover cache is harmless.
 */
export const fireCacheCleanupAfterPersist = async (
  options: CacheCleanupAfterPersistOptions
): Promise<void> => {
  await options.persist()
  if (options.cacheCleanup) {
    await options.clearCaches(options.cacheCleanup).catch(() => undefined)
  }
}
