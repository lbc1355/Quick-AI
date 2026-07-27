import type { ClearSessionCachesPayload, Session, SessionResource } from '../../../../shared/types'
import { computeResourcePrune } from '../../hooks/useSessions'
import { commitSessionRevert } from './sessionRevertService'

/**
 * Copy a session list one level into the messages so a dispatch can mutate its working copy
 * without writing through to the rendered state.
 */
export const cloneSessionsDeep = (sessions: Session[]): Session[] =>
  sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => ({ ...message }))
  }))

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
 * Commit a staged rollback: sending a new message discards the "restore" affordance, so the
 * reverted runs and any resources only they referenced become collectable.
 *
 * Pure — the caller owns both the state write and the `clearSessionCaches` IPC call. Resources are
 * pruned against the *original* (pre-revert) resource list, because that is what the reverted runs
 * actually referenced.
 */
export const planStagedRevertCommit = (
  sessions: Session[],
  sourceSession: Session
): StagedRevertCommitPlan => {
  if (!sourceSession.revert) return { session: sourceSession, sessions }

  const committed = commitSessionRevert(sourceSession)
  const nextSessions = replaceSessionInSnapshot(sessions, committed.session)
  const otherSessions = nextSessions.filter((session) => session.id !== sourceSession.id)
  const { deletableIds } = computeResourcePrune(
    { ...committed.session, resources: committed.originalResources },
    otherSessions,
    committed.committedRunIds
  )

  const hasCleanup = committed.committedRunIds.length > 0 || deletableIds.length > 0
  return {
    session: committed.session,
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
