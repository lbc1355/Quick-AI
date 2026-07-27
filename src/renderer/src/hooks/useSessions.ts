import React, { useState, useEffect, useRef } from 'react'
import { Session, SessionResource } from '../../../shared/types'
import { advanceSessionContextEpoch, getSessionContextEpoch } from '../../../shared/contextEpoch'

/**
 * Resource cache files are keyed by md5(url) and shared across sessions, so a resource is only
 * safe to delete when the target session references it AND no surviving session does. Returns the
 * target's orphaned resource ids. Pure — exported for testing.
 */
export const computeOrphanResourceIds = (target: Session, survivors: Session[]): string[] => {
  const survivorIds = new Set(survivors.flatMap((s) => (s.resources ?? []).map((r) => r.id)))
  return (target.resources ?? []).map((r) => r.id).filter((id) => !survivorIds.has(id))
}

/**
 * Partial-prune analogue of computeOrphanResourceIds for edit/regenerate: given the run ids removed
 * by a message slice, decide which of the target session's resources to drop and which are safe to
 * physically delete from the global cache.
 *
 * - A resource is pruned from the session only when EVERY run that touched it was removed
 *   (runIds ⊆ removedRunIds). A resource still touched by a surviving run is kept.
 * - Legacy resources without runIds are never auto-pruned (conservative).
 * - deletableIds excludes ids still referenced by any OTHER session (cross-session cache is shared).
 *
 * Pure — exported for testing.
 */
export const computeResourcePrune = (
  target: Session,
  otherSessions: Session[],
  removedRunIds: string[]
): { keptResources: SessionResource[]; prunedIds: string[]; deletableIds: string[] } => {
  const removed = new Set(removedRunIds)
  const kept: SessionResource[] = []
  const prunedIds: string[] = []

  for (const r of target.resources ?? []) {
    const runIds = r.runIds ?? []
    const fullyRemoved = runIds.length > 0 && runIds.every((id) => removed.has(id))
    if (fullyRemoved) prunedIds.push(r.id)
    else kept.push(r)
  }

  const otherIds = new Set(otherSessions.flatMap((s) => (s.resources ?? []).map((x) => x.id)))
  const keptIds = new Set(kept.map((x) => x.id))
  const deletableIds = prunedIds.filter((id) => !otherIds.has(id) && !keptIds.has(id))

  return { keptResources: kept, prunedIds, deletableIds }
}

/** Best-effort: delete a session's action log + orphaned resource caches. Never throws. */
const clearCachesFor = async (sessionId: string, orphanResourceIds: string[]): Promise<void> => {
  try {
    await window.api.clearSessionCaches({
      sessionIds: [sessionId],
      resourceIds: orphanResourceIds
    })
  } catch (e) {
    console.warn('Failed to clear session caches:', e)
  }
}

export interface UseSessionsReturn {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  sessionsRef: React.MutableRefObject<Session[]>
  activeSessionId: string
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>
  activeSession: Session | undefined
  draftSession: Session | null
  setDraftSession: React.Dispatch<React.SetStateAction<Session | null>>
  handleNewSession: (options?: { projectId?: string; onCreated?: () => void }) => Promise<Session>
  handleClearCurrentSession: () => Promise<void>
  handleDeleteSession: (targetSessionId: string) => Promise<void>
  handleRenameSession: (targetSessionId: string, nextTitle: string) => Promise<void>
  handleMoveSession: (
    targetSessionId: string,
    projectId: string | undefined
  ) => Promise<void>
  syncSessionsRef: (currentSessions: Session[]) => void
}

export const useSessions = (): UseSessionsReturn => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [draftSession, setDraftSession] = useState<Session | null>(null)

  // Track latest sessions state in a ref to avoid stale closures in async handlers
  const sessionsRef = useRef<Session[]>([])
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const syncSessionsRef = (currentSessions: Session[]): void => {
    sessionsRef.current = currentSessions
  }

  // Auto clear draft session when switching to a persisted session
  useEffect(() => {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) {
      setDraftSession(null)
    }
  }, [activeSessionId, sessions])

  // Load sessions from storage on startup
  useEffect(() => {
    const loadSessions = async (): Promise<void> => {
      const savedSessions = ((await window.api.storeGet('sessions')) as Session[]) || []
      setSessions(savedSessions)
      if (savedSessions.length > 0) {
        // Find most recently active session
        const sorted = [...savedSessions].sort((a, b) => {
          const tA = a.lastActiveTime || Number(a.id)
          const tB = b.lastActiveTime || Number(b.id)
          return tB - tA
        })
        setActiveSessionId(sorted[0].id)
        syncSessionsRef(savedSessions)
      } else {
        const defaultSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: [],
          contextEpoch: 0,
          lastActiveTime: Date.now()
        }
        setDraftSession(defaultSession)
        setActiveSessionId(defaultSession.id)
      }
    }
    loadSessions()
  }, [])

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ||
    (draftSession && draftSession.id === activeSessionId ? draftSession : undefined)

  const handleNewSession = async (
    options: { projectId?: string; onCreated?: () => void } = {}
  ): Promise<Session> => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [],
      contextEpoch: 0,
      lastActiveTime: Date.now(),
      projectId: options.projectId
    }
    setDraftSession(newSession)
    setActiveSessionId(newSession.id)
    options.onCreated?.()
    return newSession
  }

  const handleClearCurrentSession = async (): Promise<void> => {
    if (!activeSessionId) return

    // Clearing resets the conversation (and its resources), so wipe its caches first. Survivors
    // are all OTHER sessions — the cleared one keeps its object but no longer references anything.
    const target = sessions.find((s) => s.id === activeSessionId)
    const advancedTarget = target ? advanceSessionContextEpoch(target) : undefined
    if (target) {
      window.api.advanceSessionContext(target.id, getSessionContextEpoch(target) + 1)
      const survivors = sessions.filter((s) => s.id !== activeSessionId)
      const cacheTarget = target.revert?.originalResources
        ? { ...target, resources: target.revert.originalResources }
        : target
      await clearCachesFor(activeSessionId, computeOrphanResourceIds(cacheTarget, survivors))
    }

    const updated = sessions.map((s) => {
      if (s.id === activeSessionId) {
        return {
          ...(advancedTarget || s),
          messages: [],
          title: '新对话',
          lastActiveTime: Date.now(),
          resources: [],
          revert: undefined
        }
      }
      return s
    })
    sessionsRef.current = updated
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  const handleDeleteSession = async (targetSessionId: string): Promise<void> => {
    // Compute orphaned caches against the survivor set BEFORE any placeholder session is pushed.
    const survivors = sessions.filter((s) => s.id !== targetSessionId)
    const target = sessions.find((s) => s.id === targetSessionId)
    if (target) {
      window.api.advanceSessionContext(target.id, getSessionContextEpoch(target) + 1)
      const cacheTarget = target.revert?.originalResources
        ? { ...target, resources: target.revert.originalResources }
        : target
      await clearCachesFor(targetSessionId, computeOrphanResourceIds(cacheTarget, survivors))
    }

    const updated = sessions.filter((s) => s.id !== targetSessionId)
    if (activeSessionId === targetSessionId) {
      if (updated.length > 0) {
        setActiveSessionId(updated[0].id)
        setDraftSession(null)
      } else {
        const newSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: [],
          contextEpoch: 0,
          lastActiveTime: Date.now(),
          projectId: target?.projectId
        }
        setDraftSession(newSession)
        setActiveSessionId(newSession.id)
      }
    }
    sessionsRef.current = updated
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  const handleRenameSession = async (
    targetSessionId: string,
    nextTitle: string
  ): Promise<void> => {
    const trimmed = nextTitle.trim()
    if (!trimmed) return

    const draftMatch = draftSession?.id === targetSessionId
    const existing = sessions.find((session) => session.id === targetSessionId)
    const currentTitle = (draftMatch ? draftSession?.title : existing?.title)?.trim()
    if (currentTitle === trimmed) return

    if (draftMatch && draftSession) {
      setDraftSession({ ...draftSession, title: trimmed })
    }

    if (!existing) return

    const updated = sessions.map((session) =>
      session.id === targetSessionId ? { ...session, title: trimmed } : session
    )
    sessionsRef.current = updated
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  const handleMoveSession = async (
    targetSessionId: string,
    projectId: string | undefined
  ): Promise<void> => {
    const nextProjectId = projectId || undefined

    if (draftSession?.id === targetSessionId) {
      if ((draftSession.projectId || undefined) === nextProjectId) return
      setDraftSession({ ...draftSession, projectId: nextProjectId })
    }

    const existing = sessions.find((session) => session.id === targetSessionId)
    if (!existing) return
    if ((existing.projectId || undefined) === nextProjectId) return

    const updated = sessions.map((session) =>
      session.id === targetSessionId ? { ...session, projectId: nextProjectId } : session
    )
    sessionsRef.current = updated
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  return {
    sessions,
    setSessions,
    sessionsRef,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    draftSession,
    setDraftSession,
    handleNewSession,
    handleClearCurrentSession,
    handleDeleteSession,
    handleRenameSession,
    handleMoveSession,
    syncSessionsRef
  }
}
