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

interface UseProjectNavigationArgs {
  projects: Project[]
  sessions: Session[]
  sessionsRef: MutableRefObject<Session[]>
  activeSession: Session | undefined
  activeSessionId: string
  setProjects: Dispatch<SetStateAction<Project[]>>
  setSessions: Dispatch<SetStateAction<Session[]>>
  handleNewSession: (options?: { projectId?: string; onCreated?: () => void }) => Promise<Session>
  setSessionFamilyRootId: Dispatch<SetStateAction<string | null>>
  setDismissedSessionFamilyViewForId: Dispatch<SetStateAction<string | null>>
}

export function useProjectNavigation({
  projects,
  sessions,
  sessionsRef,
  activeSession,
  activeSessionId,
  setProjects,
  setSessions,
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
  handleDeleteProject: (projectId: string) => Promise<void>
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

  const handleAddProject = useCallback(async (): Promise<void> => {
    const selected = await window.api.selectProjectDirectory()
    if (!selected) return

    const existing = projects.find(
      (project) => normalizeProjectPath(project.path) === normalizeProjectPath(selected.path)
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
      path: selected.path,
      createdAt: now,
      updatedAt: now
    }
    const nextProjects = [project, ...projects]
    await persistProjects(nextProjects)
    await handleNewSession({ projectId: project.id })
    setSidebarProjectId(project.id)
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(null)
  }, [
    handleNewSession,
    normalizeProjectPath,
    openProject,
    persistProjects,
    projects,
    setDismissedSessionFamilyViewForId,
    setSessionFamilyRootId
  ])

  const handleDeleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return
      const relatedCount = sessions.filter((session) => session.projectId === projectId).length
      const confirmed = window.confirm(
        relatedCount > 0
          ? `移除项目「${project.name}」？磁盘文件不会被删除，${relatedCount} 个对话会保留为自由对话。`
          : `移除项目「${project.name}」？磁盘文件不会被删除。`
      )
      if (!confirmed) return

      const nextProjects = projects.filter((item) => item.id !== projectId)
      const nextSessions = sessions.map((session) =>
        session.projectId === projectId ? { ...session, projectId: undefined } : session
      )
      await persistProjects(nextProjects)
      if (sidebarProjectId === projectId) {
        setSidebarProjectId(null)
      }
      setSessions(nextSessions)
      sessionsRef.current = nextSessions
      await window.api.storeSet('sessions', nextSessions)
    },
    [persistProjects, projects, sessions, sessionsRef, setSessions, sidebarProjectId]
  )

  return {
    setSidebarProjectId,
    activeProject,
    sidebarProject,
    projectSessionCounts,
    openProject,
    openFreeConversations,
    handleAddProject,
    handleDeleteProject
  }
}
