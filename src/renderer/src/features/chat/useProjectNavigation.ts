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
import { getSessionContextEpoch } from '../../../../shared/contextEpoch'
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
  handleDeleteProject: (
    projectId: string,
    options?: { deleteSessions?: boolean }
  ) => Promise<void>
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
    const counts = new Map<string, number>()
    for (const session of sessions) {
      if (!session.projectId) continue
      counts.set(session.projectId, (counts.get(session.projectId) || 0) + 1)
    }
    return counts
  }, [sessions])

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
    if (!selected) return

    const existing = projects.find(
      (project) =>
        isFilesystemProject(project) &&
        project.path &&
        normalizeProjectPath(project.path) === normalizeProjectPath(selected.path)
    )
    if (existing) {
      openProject(existing.id)
      return
    }

    const now = Date.now()
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name:
        selected.name ||
        selected.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
        'Project',
      kind: 'filesystem',
      path: selected.path,
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
    async (
      projectId: string,
      options: { deleteSessions?: boolean } = {}
    ): Promise<void> => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return

      const currentSessions = sessionsRef.current
      const relatedSessions = currentSessions.filter((session) => session.projectId === projectId)
      const deleteContainedSessions = Boolean(
        isConversationFolder(project) && options.deleteSessions
      )

      const nextProjects = projects.filter((item) => item.id !== projectId)
      let nextSessions: Session[]

      if (deleteContainedSessions) {
        const survivors = currentSessions.filter((session) => session.projectId !== projectId)
        for (const target of relatedSessions) {
          window.api.advanceSessionContext(target.id, getSessionContextEpoch(target) + 1)
          const cacheTarget = target.revert?.originalResources
            ? { ...target, resources: target.revert.originalResources }
            : target
          await clearCachesFor(target.id, computeOrphanResourceIds(cacheTarget, survivors))
        }
        nextSessions = survivors

        if (relatedSessions.some((session) => session.id === activeSessionId)) {
          if (nextSessions.length > 0) {
            setActiveSessionId(nextSessions[0].id)
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
      }

      await persistProjects(nextProjects)
      if (sidebarProjectId === projectId) {
        setSidebarProjectId(null)
      }
      setSessions(nextSessions)
      sessionsRef.current = nextSessions
      await window.api.storeSet('sessions', nextSessions)
    },
    [
      activeSessionId,
      persistProjects,
      projects,
      sessionsRef,
      setActiveSessionId,
      setDraftSession,
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
