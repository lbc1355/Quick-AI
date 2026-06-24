import { useCallback, useMemo } from 'react'
import type { AutocompleteItem, Session } from '../../../../shared/types'
import {
  buildBranchFamilyInfo,
  getBranchFamilyRootId,
  type BranchFamilyInfo,
  type BranchFamilyMemberInfo
} from '../../utils/branchDisplay'

interface UseSessionFamilyViewOptions {
  sessions: Session[]
  activeSessionId: string | null
  sessionFamilyRootId: string | null
  setSessionFamilyRootId: (sessionId: string | null) => void
  dismissedSessionFamilyViewForId: string | null
  setDismissedSessionFamilyViewForId: (sessionId: string | null) => void
  setSidebarProjectId: (projectId: string | null) => void
  setPendingScrollMessageId: (messageId: string) => void
  setActiveSessionId: (sessionId: string) => void
  setAutocompleteItems: (items: AutocompleteItem[]) => void
}

interface VisibleSessionEntry {
  session: Session
  familyMember: BranchFamilyMemberInfo<Session> | null
}

interface UseSessionFamilyViewResult {
  sessionFamilyRootId: string | null
  setSessionFamilyRootId: (sessionId: string | null) => void
  setDismissedSessionFamilyViewForId: (sessionId: string | null) => void
  visibleSessionFamilyInfo: BranchFamilyInfo<Session> | null
  buildVisibleSessionEntries: (scopedSessions: Session[]) => VisibleSessionEntry[]
  enterSessionFamilyView: (sessionId: string) => void
  exitSessionFamilyView: () => void
  openSession: (sessionId: string, messageId?: string) => void
}

export function useSessionFamilyView({
  sessions,
  activeSessionId,
  sessionFamilyRootId,
  setSessionFamilyRootId,
  dismissedSessionFamilyViewForId,
  setDismissedSessionFamilyViewForId,
  setSidebarProjectId,
  setPendingScrollMessageId,
  setActiveSessionId,
  setAutocompleteItems
}: UseSessionFamilyViewOptions): UseSessionFamilyViewResult {
  const activeSessionFamilyInfo = useMemo(() => {
    if (!activeSessionId) return null
    const rootId = getBranchFamilyRootId(activeSessionId, sessions)
    const info = buildBranchFamilyInfo(rootId, sessions)
    return info && info.members.length > 1 ? info : null
  }, [activeSessionId, sessions])

  const isSessionFamilyViewDismissed = dismissedSessionFamilyViewForId === activeSessionId

  const visibleSessionFamilyInfo = useMemo(() => {
    const effectiveRootId = isSessionFamilyViewDismissed
      ? sessionFamilyRootId
      : sessionFamilyRootId || activeSessionFamilyInfo?.rootSessionId
    if (!effectiveRootId) return null
    const info = buildBranchFamilyInfo(effectiveRootId, sessions)
    return info && info.members.length > 1 ? info : null
  }, [
    activeSessionFamilyInfo?.rootSessionId,
    isSessionFamilyViewDismissed,
    sessionFamilyRootId,
    sessions
  ])

  const enterSessionFamilyView = useCallback(
    (sessionId: string): void => {
      const rootId = getBranchFamilyRootId(sessionId, sessions)
      const info = buildBranchFamilyInfo(rootId, sessions)
      setSessionFamilyRootId(info && info.members.length > 1 ? rootId : null)
      setDismissedSessionFamilyViewForId(null)
    },
    [sessions]
  )

  const exitSessionFamilyView = useCallback((): void => {
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(activeSessionId ?? null)
  }, [activeSessionId])

  const openSession = useCallback(
    (sessionId: string, messageId?: string): void => {
      const targetSession = sessions.find((session) => session.id === sessionId)
      setSidebarProjectId(targetSession?.projectId ?? null)
      if (messageId) {
        setPendingScrollMessageId(messageId)
      }
      enterSessionFamilyView(sessionId)
      setActiveSessionId(sessionId)
      setAutocompleteItems([])
    },
    [
      enterSessionFamilyView,
      sessions,
      setActiveSessionId,
      setAutocompleteItems,
      setPendingScrollMessageId,
      setSidebarProjectId
    ]
  )

  const buildVisibleSessionEntries = useCallback(
    (scopedSessions: Session[]): VisibleSessionEntry[] =>
      visibleSessionFamilyInfo
        ? visibleSessionFamilyInfo.members.map((familyMember) => ({
            session: familyMember.session,
            familyMember
          }))
        : scopedSessions.map((session) => ({ session, familyMember: null })),
    [visibleSessionFamilyInfo]
  )

  return {
    sessionFamilyRootId,
    setSessionFamilyRootId,
    setDismissedSessionFamilyViewForId,
    visibleSessionFamilyInfo,
    buildVisibleSessionEntries,
    enterSessionFamilyView,
    exitSessionFamilyView,
    openSession
  }
}
