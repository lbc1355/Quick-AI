import React, { useState, useEffect, useRef } from 'react'
import { Session } from '../../../shared/types'

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

    // If the active session is empty, do nothing
    if (activeSess.messages.length === 0) return

    const lastActive = activeSess.lastActiveTime || Number(activeSess.id)
    const elapsed = Date.now() - lastActive
    const fiveMinutes = 5 * 60 * 1000

    if (elapsed > fiveMinutes) {
      // Create new session
      const newSession: Session = {
        id: Date.now().toString(),
        title: '新对话',
        messages: [],
        lastActiveTime: Date.now()
      }
      const updated = [newSession, ...currentSessions]
      setSessions(updated)
      sessionsRef.current = updated
      setActiveSessionId(newSession.id)
      await window.api.storeSet('sessions', updated)
    } else {
      // Within 5 minutes, only persist the active timer. Avoid a visible rerender on every summon.
      const updated = currentSessions.map((s) =>
        s.id === currentActiveId ? { ...s, lastActiveTime: Date.now() } : s
      )
      sessionsRef.current = updated
      await window.api.storeSet('sessions', updated)
    }
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
    const updated = sessions.map((s) => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [], title: '新对话', lastActiveTime: Date.now() }
      }
      return s
    })
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  const handleDeleteSession = async (targetSessionId: string): Promise<void> => {
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
