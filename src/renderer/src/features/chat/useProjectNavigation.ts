import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { Project, Session } from '../../../../shared/types'
import { advanceSessionContextEpoch, getSessionContextEpoch } from '../../../../shared/contextEpoch'
import { isConversationFolder, isFilesystemProject } from '../../../../shared/projectHelpers'
import { computeOrphanResourceIds } from '../../hooks/useSessions'

interface UseProjectNavigationArgs {
  projects: Project[]
  sessions: Session[]
  sessionsRef: MutableRefObject<Session[]>
  activeSession: Session | undefined
  activeSessionId: string
  setProjects: Dispatch<SetStateAction<Project[]>>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setActiveSessionId: Dispatch<SetStateAction<string>>
  setDraftSession: Dispatch<SetStateAction<Session | null>>
  handleNewSession: (options?: { projectId?: string; onCreated?: () => void }) => Promise<Session>
  setSessionFamilyRootId: Dispatch<SetStateAction<string | null>>
  setDismissedSessionFamilyViewForId: Dispatch<SetStateAction<string | null>>
}

const clearCachesFor = async (sessionId: string, orphanResourceIds: string[]): Promise<void> => {
  try {
    await window.api.clearSessionCaches({
      sessionIds: [sessionId],
      resourceIds: orphanResourceIds
    })
  } catch (error) {
    console.warn('Failed to clear session caches:', error)
  }
}

export const getUnpersistedActiveSession = (
  sessions: Session[],
  activeSession: Session | undefined
): Session | undefined => {
  if (!activeSession) return undefined
  return sessions.some((session) => session.id === activeSession.id) ? undefined : activeSession
}

export const countSessionsByProject = (
  sessions: Session[],
  unpersistedSession?: Session
): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const session of unpersistedSession ? [...sessions, unpersistedSession] : sessions) {
    if (!session.projectId) continue
    counts.set(session.projectId, (counts.get(session.projectId) || 0) + 1)
  }
  return counts
}

export function useProjectNavigation({
  projects,
  sessions,
  sessionsRef,
  activeSession,
  activeSessionId,
  setProjects,
  setSessions,
  setActiveSessionId,
  setDraftSession,
  handleNewSession,
  setSessionFamilyRootId,
  setDismissedSessionFamilyViewForId
}: UseProjectNavigationArgs): {
  setSidebarProjectId: Dispatch<SetStateAction<string | null | undefined>>
  activeProject: Project | null
  sidebarProject: Project | null
  projectSessionCounts: Map<string, number>
  openProject: (projectId: string) => void
  openFreeConversations: () => void
  handleAddProject: () => Promise<void>
  handleAddConversationFolder: (name: string) => Promise<void>
  handleDeleteProject: (projectId: string, options?: { deleteSessions?: boolean }) => Promise<void>
} {
  const [sidebarProjectId, setSidebarProjectId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let disposed = false
    window.api
      .storeGet('projects')
      .then((savedProjects) => {
        if (!disposed) setProjects(savedProjects || [])
      })
      .catch((err) => console.warn('Failed to load projects:', err))
    return () => {
      disposed = true
    }
  }, [setProjects])

  const persistProjects = useCallback(
    async (nextProjects: Project[]): Promise<void> => {
      setProjects(nextProjects)
      await window.api.storeSet('projects', nextProjects)
    },
    [setProjects]
  )

  const normalizeProjectPath = useCallback((projectPath: string): string => {
    const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
    return normalized.toLowerCase()
  }, [])

  const activeProject = useMemo(() => {
    if (!activeSession?.projectId) return null
    return projects.find((project) => project.id === activeSession.projectId) || null
  }, [activeSession?.projectId, projects])

  const resolvedSidebarProjectId =
    sidebarProjectId === undefined ? (activeSession?.projectId ?? null) : sidebarProjectId
  const sidebarProject = useMemo(() => {
    if (!resolvedSidebarProjectId) return null
    return projects.find((project) => project.id === resolvedSidebarProjectId) || null
  }, [projects, resolvedSidebarProjectId])

  const projectSessionCounts = useMemo(() => {
    return countSessionsByProject(sessions, getUnpersistedActiveSession(sessions, activeSession))
  }, [activeSession, sessions])

  const openProject = useCallback(
    (projectId: string): void => {
      setSidebarProjectId(projectId)
      setSessionFamilyRootId(null)
      setDismissedSessionFamilyViewForId(activeSessionId || null)
    },
    [activeSessionId, setDismissedSessionFamilyViewForId, setSessionFamilyRootId]
  )

  const openFreeConversations = useCallback((): void => {
    setSidebarProjectId(null)
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(activeSessionId || null)
  }, [activeSessionId, setDismissedSessionFamilyViewForId, setSessionFamilyRootId])

  const activateContainer = useCallback(
    async (project: Project): Promise<void> => {
      const nextProjects = [project, ...projects.filter((item) => item.id !== project.id)]
      await persistProjects(nextProjects)
      await handleNewSession({ projectId: project.id })
      setSidebarProjectId(project.id)
      setSessionFamilyRootId(null)
      setDismissedSessionFamilyViewForId(null)
    },
    [
      handleNewSession,
      persistProjects,
      projects,
      setDismissedSessionFamilyViewForId,
      setSessionFamilyRootId
    ]
  )

  const handleAddProject = useCallback(async (): Promise<void> => {
    const selected = await window.api.selectProjectDirectory()
    if (!selected?.path) return

    const selectedPath = selected.path
    const existing = projects.find((project) => {
      if (!isFilesystemProject(project) || !project.path) return false
      return normalizeProjectPath(project.path) === normalizeProjectPath(selectedPath)
    })
    if (existing) {
      openProject(existing.id)
      return
    }

    const now = Date.now()
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name:
        selected.name ||
        selectedPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
        'Project',
      kind: 'filesystem',
      path: selectedPath,
      createdAt: now,
      updatedAt: now
    }
    await activateContainer(project)
  }, [activateContainer, normalizeProjectPath, openProject, projects])

  const handleAddConversationFolder = useCallback(
    async (rawName: string): Promise<void> => {
      const name = rawName.trim()
      if (!name) return

      const duplicate = projects.find(
        (project) => isConversationFolder(project) && project.name.trim() === name
      )
      if (duplicate) {
        openProject(duplicate.id)
        return
      }

      const now = Date.now()
      const project: Project = {
        id: `folder-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        kind: 'folder',
        createdAt: now,
        updatedAt: now
      }
      await activateContainer(project)
    },
    [activateContainer, openProject, projects]
  )

  const handleDeleteProject = useCallback(
    async (projectId: string, options: { deleteSessions?: boolean } = {}): Promise<void> => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return

      const currentSessions = sessionsRef.current
      const activeDraft = getUnpersistedActiveSession(currentSessions, activeSession)
      const draftInProject = activeDraft?.projectId === projectId ? activeDraft : undefined
      const relatedSessions = currentSessions.filter((session) => session.projectId === projectId)
      const deleteContainedSessions = Boolean(
        isConversationFolder(project) && options.deleteSessions
      )
      const relatedSessionIds = new Set(relatedSessions.map((session) => session.id))
      const activeWillBeDeleted =
        deleteContainedSessions &&
        (relatedSessionIds.has(activeSessionId) || draftInProject?.id === activeSessionId)

      const nextProjects = projects.filter((item) => item.id !== projectId)
      let rollbackSessions = currentSessions
      let nextSessions: Session[]

      if (deleteContainedSessions) {
        rollbackSessions = currentSessions.map((session) =>
          relatedSessionIds.has(session.id) ? advanceSessionContextEpoch(session) : session
        )
        for (const target of relatedSessions) {
          window.api.advanceSessionContext(target.id, getSessionContextEpoch(target) + 1)
        }
        const survivors = currentSessions.filter((session) => !relatedSessionIds.has(session.id))
        nextSessions = survivors

        if (activeWillBeDeleted) {
          if (survivors.length > 0) {
            setActiveSessionId(survivors[0].id)
            setDraftSession(null)
          } else {
            const placeholder: Session = {
              id: Date.now().toString(),
              title: '新对话',
              messages: [],
              contextEpoch: 0,
              lastActiveTime: Date.now()
            }
            setDraftSession(placeholder)
            setActiveSessionId(placeholder.id)
          }
        }
      } else {
        nextSessions = currentSessions.map((session) =>
          session.projectId === projectId ? { ...session, projectId: undefined } : session
        )
        if (draftInProject) {
          setDraftSession({ ...draftInProject, projectId: undefined })
        }
      }

      // Update refs before crossing the IPC boundary. Streaming/background callbacks read this ref,
      // so they cannot re-persist a project id that is being removed.
      setProjects(nextProjects)
      sessionsRef.current = nextSessions
      setSessions(nextSessions)
      if (sidebarProjectId === projectId) {
        setSidebarProjectId(null)
      }

      try {
        await window.api.deleteProject(projectId, { deleteSessions: deleteContainedSessions })
      } catch (error) {
        console.error('Failed to delete project:', error)

        // Roll back the organization change while preserving any unrelated updates that landed
        // during the IPC call. Deleted targets cannot receive stream updates after their context
        // was advanced, so their pre-operation snapshot is safe to restore.
        const latestSessions = sessionsRef.current
        let restoredSessions: Session[]
        if (deleteContainedSessions) {
          const latestById = new Map(latestSessions.map((session) => [session.id, session]))
          const originalIds = new Set(rollbackSessions.map((session) => session.id))
          restoredSessions = [
            ...rollbackSessions.map((session) => latestById.get(session.id) || session),
            ...latestSessions.filter((session) => !originalIds.has(session.id))
          ]
        } else {
          restoredSessions = latestSessions.map((session) =>
            relatedSessionIds.has(session.id) ? { ...session, projectId } : session
          )
        }

        setProjects(projects)
        sessionsRef.current = restoredSessions
        setSessions(restoredSessions)
        if (draftInProject) setDraftSession(draftInProject)
        if (activeWillBeDeleted) setActiveSessionId(activeSessionId)
        if (sidebarProjectId === projectId) setSidebarProjectId(projectId)
        return
      }

      if (deleteContainedSessions) {
        const survivors = sessionsRef.current
        for (const target of relatedSessions) {
          const cacheTarget = target.revert?.originalResources
            ? { ...target, resources: target.revert.originalResources }
            : target
          await clearCachesFor(target.id, computeOrphanResourceIds(cacheTarget, survivors))
        }
        if (draftInProject) {
          await clearCachesFor(
            draftInProject.id,
            computeOrphanResourceIds(draftInProject, survivors)
          )
        }
      }
    },
    [
      activeSession,
      activeSessionId,
      projects,
      sessionsRef,
      setActiveSessionId,
      setDraftSession,
      setProjects,
      setSessions,
      sidebarProjectId
    ]
  )

  return {
    setSidebarProjectId,
    activeProject,
    sidebarProject,
    projectSessionCounts,
    openProject,
    openFreeConversations,
    handleAddProject,
    handleAddConversationFolder,
    handleDeleteProject
  }
}
