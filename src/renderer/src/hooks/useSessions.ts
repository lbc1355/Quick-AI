import React, { useState, useEffect, useRef } from 'react'
import { Session, SessionResource } from '../../../shared/types'

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
  handleNewSession: (onCreated?: () => void) => Promise<void>
  handleClearCurrentSession: () => Promise<void>
  handleDeleteSession: (targetSessionId: string) => Promise<void>
  checkSessionTimeout: (currentActiveId: string, currentSessions: Session[]) => Promise<void>
}

export const useSessions = (): UseSessionsReturn => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')

  // Track latest sessions state in a ref to avoid stale closures in async handlers
  const sessionsRef = useRef<Session[]>([])
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const checkSessionTimeout = async (
    currentActiveId: string,
    currentSessions: Session[]
  ): Promise<void> => {
    if (currentSessions.length === 0 || !currentActiveId) return

    const activeSess = currentSessions.find((s) => s.id === currentActiveId)
    if (!activeSess) return

    // Summoning the panel should never create or touch a conversation. Timeout splitting happens
    // only when the user actually sends a message.
    sessionsRef.current = currentSessions
  }

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
        checkSessionTimeout(sorted[0].id, savedSessions)
      } else {
        const defaultSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: [],
          lastActiveTime: Date.now()
        }
        const updated = [defaultSession]
        setSessions(updated)
        setActiveSessionId(defaultSession.id)
        await window.api.storeSet('sessions', updated)
      }
    }
    loadSessions()
  }, [])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const handleNewSession = async (onCreated?: () => void): Promise<void> => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [],
      lastActiveTime: Date.now()
    }
    const updated = [newSession, ...sessions]
    setSessions(updated)
    setActiveSessionId(newSession.id)
    await window.api.storeSet('sessions', updated)
    if (onCreated) onCreated()
  }

  const handleClearCurrentSession = async (): Promise<void> => {
    if (!activeSessionId) return

    // Clearing resets the conversation (and its resources), so wipe its caches first. Survivors
    // are all OTHER sessions — the cleared one keeps its object but no longer references anything.
    const target = sessions.find((s) => s.id === activeSessionId)
    if (target) {
      const survivors = sessions.filter((s) => s.id !== activeSessionId)
      await clearCachesFor(activeSessionId, computeOrphanResourceIds(target, survivors))
    }

    const updated = sessions.map((s) => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [], title: '新对话', lastActiveTime: Date.now(), resources: [] }
      }
      return s
    })
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  const handleDeleteSession = async (targetSessionId: string): Promise<void> => {
    // Compute orphaned caches against the survivor set BEFORE any placeholder session is pushed.
    const survivors = sessions.filter((s) => s.id !== targetSessionId)
    const target = sessions.find((s) => s.id === targetSessionId)
    if (target) {
      await clearCachesFor(targetSessionId, computeOrphanResourceIds(target, survivors))
    }

    const updated = sessions.filter((s) => s.id !== targetSessionId)
    if (activeSessionId === targetSessionId) {
      if (updated.length > 0) {
        setActiveSessionId(updated[0].id)
      } else {
        const newSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: [],
          lastActiveTime: Date.now()
        }
        updated.push(newSession)
        setActiveSessionId(newSession.id)
      }
    }
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
    handleNewSession,
    handleClearCurrentSession,
    handleDeleteSession,
    checkSessionTimeout
  }
}
