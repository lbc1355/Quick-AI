import React, { useEffect, useRef, useState } from 'react'
import {
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
  ArrowLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  Library,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  HardDrive,
  FolderInput,
  LoaderCircle
} from 'lucide-react'
import { Project, Session } from '../../../shared/types'
import { isConversationFolder } from '../../../shared/projectHelpers'
import {
  BranchFamilyInfo,
  BranchFamilyMemberInfo,
  getBranchDisplayInfo
} from '../utils/branchDisplay'
import { formatSessionStamp } from '../utils/autocompleteHelpers'
import { ProjectDeleteModal, type ProjectDeleteChoice } from './ProjectDeleteModal'

interface SessionSidebarProps {
  sessions: Session[]
  projects: Project[]
  activeProjectId: string | null
  projectSessionCounts: Map<string, number>
  activeSessionId: string
  isSidebarCollapsed: boolean
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  visibleSessionFamilyInfo: BranchFamilyInfo<Session> | null
  visibleSessionEntries: Array<{
    session: Session
    familyMember: BranchFamilyMemberInfo<Session> | null
  }>
  isGenerating: boolean
  generatingSessionIds: ReadonlySet<string>
  activeProviderName: string
  activeModelName: string
  onAddProject: () => void
  onAddConversationFolder: (name: string) => void
  onOpenProject: (projectId: string) => void
  onOpenFreeConversations: () => void
  onDeleteProject: (projectId: string, options?: { deleteSessions?: boolean }) => void
  exitSessionFamilyView: () => void
  handleNewSession: () => Promise<Session>
  handleDeleteSession: (id: string) => Promise<void>
  handleRenameSession: (id: string, nextTitle: string) => Promise<void>
  handleMoveSession: (id: string, projectId: string | undefined) => Promise<void>
  openSession: (sessionId: string) => void
  setSessionFamilyRootId: (id: string | null) => void
  setDismissedSessionFamilyViewForId: (id: string | null) => void
  setAutocompleteItems: (items: never[]) => void
}

const SessionSidebarComponent: React.FC<SessionSidebarProps> = ({
  sessions,
  projects,
  activeProjectId,
  projectSessionCounts,
  activeSessionId,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  visibleSessionFamilyInfo,
  visibleSessionEntries,
  isGenerating,
  generatingSessionIds,
  activeProviderName,
  activeModelName,
  onAddProject,
  onAddConversationFolder,
  onOpenProject,
  onOpenFreeConversations,
  onDeleteProject,
  exitSessionFamilyView,
  handleNewSession,
  handleDeleteSession,
  handleRenameSession,
  handleMoveSession,
  openSession,
  setSessionFamilyRootId,
  setDismissedSessionFamilyViewForId,
  setAutocompleteItems
}) => {
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null)
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [folderDraft, setFolderDraft] = useState('新对话文件夹')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const projectMenuContainerRef = useRef<HTMLDivElement | null>(null)
  const addMenuContainerRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const skipFolderCommitRef = useRef(false)

  const freeSessionCount = sessions.filter((session) => !session.projectId).length
  const conversationFolders = projects.filter((project) => isConversationFolder(project))
  const filesystemProjects = projects.filter((project) => !isConversationFolder(project))
  const pendingDeleteProject =
    projects.find((project) => project.id === pendingDeleteProjectId) || null

  const renderProjectEntry = (project: Project): React.ReactNode => {
    const folder = isConversationFolder(project)
    const isProjectMenuOpen = menuProjectId === project.id
    return (
      <div
        key={project.id}
        className={`project-entry ${isProjectMenuOpen ? 'menu-open' : ''}`}
      >
        <button
          type="button"
          className={`project-row ${activeProjectId === project.id ? 'active' : ''}`}
          onClick={() => onOpenProject(project.id)}
          title={folder ? project.name : project.path}
        >
          {folder ? <Library size={13} /> : <Folder size={13} />}
          <span className="project-row-title">{project.name}</span>
          <span className="project-row-count">
            {projectSessionCounts.get(project.id) || 0}
          </span>
        </button>
        <div
          className="project-item-actions"
          ref={isProjectMenuOpen ? projectMenuContainerRef : undefined}
        >
          <button
            type="button"
            className="project-menu-btn"
            aria-haspopup="menu"
            aria-expanded={isProjectMenuOpen}
            onClick={(event) => {
              event.stopPropagation()
              setMenuSessionId(null)
              setMenuProjectId((current) => (current === project.id ? null : project.id))
            }}
            title="更多操作"
          >
            <MoreHorizontal size={12} />
          </button>
          {isProjectMenuOpen ? (
            <div className="session-item-menu project-item-menu" role="menu">
              <button
                type="button"
                className="session-item-menu-item danger"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuProjectId(null)
                  setPendingDeleteProjectId(project.id)
                }}
              >
                <Trash2 size={12} />
                <span>{folder ? '删除文件夹' : '移除项目'}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }
  const startNewSession = (): void => {
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(null)
    void handleNewSession()
    setAutocompleteItems([])
  }

  const closeSessionMenu = (): void => {
    setMenuSessionId(null)
  }

  const beginRename = (session: Session): void => {
    setMenuSessionId(null)
    setRenamingSessionId(session.id)
    setRenameDraft(session.title || '')
  }

  const cancelRename = (): void => {
    setRenamingSessionId(null)
    setRenameDraft('')
  }

  const commitRename = async (): Promise<void> => {
    if (!renamingSessionId) return
    const sessionId = renamingSessionId
    const nextTitle = renameDraft.trim()
    cancelRename()
    if (!nextTitle) return
    await handleRenameSession(sessionId, nextTitle)
  }

  const beginCreateConversationFolder = (): void => {
    skipFolderCommitRef.current = false
    setIsAddMenuOpen(false)
    setIsCreatingFolder(true)
    setFolderDraft('新对话文件夹')
  }

  const cancelCreateConversationFolder = (): void => {
    skipFolderCommitRef.current = true
    setIsCreatingFolder(false)
    setFolderDraft('新对话文件夹')
  }

  const commitCreateConversationFolder = (): void => {
    if (skipFolderCommitRef.current) {
      skipFolderCommitRef.current = false
      return
    }
    if (!isCreatingFolder) return
    const nextName = folderDraft.trim()
    setIsCreatingFolder(false)
    setFolderDraft('新对话文件夹')
    if (!nextName) return
    onAddConversationFolder(nextName)
  }

  useEffect(() => {
    if (!menuSessionId && !menuProjectId && !isAddMenuOpen) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (menuSessionId && !menuContainerRef.current?.contains(target)) {
        setMenuSessionId(null)
      }
      if (menuProjectId && !projectMenuContainerRef.current?.contains(target)) {
        setMenuProjectId(null)
      }
      if (isAddMenuOpen && !addMenuContainerRef.current?.contains(target)) {
        setIsAddMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuSessionId(null)
        setMenuProjectId(null)
        setIsAddMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isAddMenuOpen, menuProjectId, menuSessionId])

  useEffect(() => {
    if (!renamingSessionId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingSessionId])

  useEffect(() => {
    if (!isCreatingFolder) return
    folderInputRef.current?.focus()
    folderInputRef.current?.select()
  }, [isCreatingFolder])

  return (
    <aside className={`session-sidebar ${visibleSessionFamilyInfo ? 'session-family-view' : ''}`}>
      <div className="session-sidebar-header">
        <div className="sidebar-heading">
          <div className="sidebar-title">{visibleSessionFamilyInfo ? '派生视图' : '工作区'}</div>
          <div className="sidebar-subtitle">
            {visibleSessionFamilyInfo
              ? `${visibleSessionFamilyInfo.rootTitle} · ${visibleSessionFamilyInfo.members.length} 个对话`
              : `${sessions.length} 个对话`}
          </div>
        </div>
        <div className="sidebar-actions">
          {visibleSessionFamilyInfo && !isSidebarCollapsed && (
            <button
              type="button"
              className="sidebar-icon-btn"
              onClick={exitSessionFamilyView}
              title="返回全部对话"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <button
            type="button"
            className="sidebar-icon-btn"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            title={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>
      </div>

      <div className="session-list">
        <div className="sidebar-section project-section">
          <div className="sidebar-section-header project-section-header">
            <span className="sidebar-section-label">
              <span>分类</span>
              <ChevronRight size={12} />
            </span>
            <div className="sidebar-add-actions" ref={addMenuContainerRef}>
              <button
                type="button"
                className="sidebar-mini-action"
                onClick={() => setIsAddMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isAddMenuOpen}
                title="添加项目或对话文件夹"
              >
                <FolderPlus size={12} />
              </button>
              {isAddMenuOpen ? (
                <div className="session-item-menu sidebar-add-menu" role="menu">
                  <button
                    type="button"
                    className="session-item-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setIsAddMenuOpen(false)
                      onAddProject()
                    }}
                  >
                    <HardDrive size={12} />
                    <span>添加项目</span>
                  </button>
                  <button
                    type="button"
                    className="session-item-menu-item"
                    role="menuitem"
                    onClick={() => {
                      beginCreateConversationFolder()
                    }}
                  >
                    <Library size={12} />
                    <span>添加对话文件夹</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="project-list">
            <div className="project-entry">
              <button
                type="button"
                className={`project-row ${activeProjectId ? '' : 'active'}`}
                onClick={onOpenFreeConversations}
                title="未分类的自由对话"
              >
                <MessageSquarePlus size={13} />
                <span className="project-row-title">自由对话</span>
                <span className="project-row-count">{freeSessionCount}</span>
              </button>
            </div>
            {isCreatingFolder ? (
              <div className="project-entry project-create-entry">
                <div className="project-row project-create-row">
                  <Library size={13} />
                  <input
                    ref={folderInputRef}
                    className="project-create-input"
                    value={folderDraft}
                    aria-label="对话文件夹名称"
                    onChange={(event) => setFolderDraft(event.target.value)}
                    onBlur={() => {
                      commitCreateConversationFolder()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelCreateConversationFolder()
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}
            {/* 渲染所有对话文件夹 */}
            {conversationFolders.map(renderProjectEntry)}

            {/* 渲染项目文件夹（有独立的项目子分组与分隔线） */}
            {filesystemProjects.length > 0 && (
              <div className="project-subgroup">
                <div className="project-subgroup-divider" />
                <div className="project-subgroup-title">
                  <span>项目</span>
                </div>
                {filesystemProjects.map(renderProjectEntry)}
              </div>
            )}
            {projects.length === 0 && !isCreatingFolder && (
              <button
                type="button"
                className="project-row project-empty-row"
                onClick={() => setIsAddMenuOpen(true)}
              >
                <FolderPlus size={13} />
                <span className="project-row-title">添加分类</span>
                <span className="project-row-count">+</span>
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-section conversation-section">
          <div className="sidebar-section-header conversation-section-header">
            <span className="sidebar-section-label">
              <span>对话</span>
              <ChevronRight size={12} />
            </span>
            {!visibleSessionFamilyInfo && (
              <button
                type="button"
                className="sidebar-mini-action"
                onClick={startNewSession}
                title="新对话"
              >
                <MessageSquarePlus size={12} />
              </button>
            )}
          </div>

          <div className="conversation-list">
            {visibleSessionEntries.map(({ session, familyMember }) => {
              const isActive = session.id === activeSessionId
              const isSessionGenerating = generatingSessionIds.has(session.id)
              const isMenuOpen = menuSessionId === session.id
              const isRenaming = renamingSessionId === session.id
              const sessionStamp = formatSessionStamp(session.lastActiveTime, session.id)
              const branchInfo = getBranchDisplayInfo(session.branchOf, sessions, '源会话')
              const baseSessionTitle = session.title || 'New chat'
              const sessionTitle = familyMember
                ? `${familyMember.isRoot ? 'Root' : `派生 ${familyMember.branchIndex}`} · ${baseSessionTitle}`
                : baseSessionTitle
              const isBranchSession = Boolean(
                (familyMember && !familyMember.isRoot) || (!familyMember && branchInfo)
              )
              const familySourceTitle =
                familyMember?.sourceTitle || visibleSessionFamilyInfo?.rootTitle || '源对话'
              const familyMeta = familyMember
                ? familyMember.isRoot
                  ? `${visibleSessionFamilyInfo?.branchCount ?? 0} 个派生`
                  : `派生自 ${familySourceTitle}${familyMember.shortRunId ? ` · run ${familyMember.shortRunId}` : ''}`
                : null
              return (
                <div
                  key={session.id}
                  className={`session-item ${isActive ? 'active' : ''} ${isBranchSession ? 'branch-session-item' : ''} ${familyMember?.isRoot ? 'family-root-session' : ''} ${isMenuOpen ? 'menu-open' : ''} ${isRenaming ? 'renaming' : ''}`}
                >
                  {isRenaming ? (
                    <div className="session-main-btn session-renaming-row">
                      <span
                        className={`session-initial ${isBranchSession ? 'branch-session-initial' : ''}`}
                        aria-hidden="true"
                      >
                        {isBranchSession ? (
                          <GitBranch size={13} />
                        ) : (
                          (session.title || 'N').trim().charAt(0).toUpperCase()
                        )}
                      </span>
                      <input
                        ref={renameInputRef}
                        className="session-rename-input"
                        value={renameDraft}
                        aria-label="重命名对话"
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => {
                          void commitRename()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.blur()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelRename()
                          }
                        }}
                      />
                      <span
                        className={`session-meta ${branchInfo || familyMember ? 'session-meta-with-branch' : ''} ${isSessionGenerating ? 'session-meta-running' : ''}`}
                      >
                        {isSessionGenerating ? (
                          <LoaderCircle
                            size={10}
                            className="session-running-icon"
                            aria-label="正在生成"
                          />
                        ) : null}
                        {branchInfo || familyMember ? <GitBranch size={10} /> : null}
                        <span title={familyMeta || branchInfo?.sourceTitle || undefined}>
                          {sessionStamp}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="session-main-btn"
                      onClick={() => {
                        openSession(session.id)
                      }}
                      title={
                        familyMember
                          ? sessionTitle
                          : branchInfo
                            ? `${sessionTitle} · 派生自 ${branchInfo.sourceLabel}`
                            : sessionTitle
                      }
                    >
                      <span
                        className={`session-initial ${isBranchSession ? 'branch-session-initial' : ''}`}
                        aria-hidden="true"
                      >
                        {isBranchSession ? (
                          <GitBranch size={13} />
                        ) : (
                          (session.title || 'N').trim().charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="session-title">{sessionTitle}</span>
                      <span
                        className={`session-meta ${branchInfo || familyMember ? 'session-meta-with-branch' : ''} ${isSessionGenerating ? 'session-meta-running' : ''}`}
                      >
                        {isSessionGenerating ? (
                          <LoaderCircle
                            size={10}
                            className="session-running-icon"
                            aria-label="正在生成"
                          />
                        ) : null}
                        {branchInfo || familyMember ? <GitBranch size={10} /> : null}
                        <span title={familyMeta || branchInfo?.sourceTitle || undefined}>
                          {sessionStamp}
                        </span>
                      </span>
                    </button>
                  )}
                  <div
                    className="session-item-actions"
                    ref={isMenuOpen ? menuContainerRef : undefined}
                  >
                    <button
                      type="button"
                      className="session-menu-btn"
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuSessionId((current) => (current === session.id ? null : session.id))
                      }}
                      title="更多操作"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    {isMenuOpen ? (
                      <div className="session-item-menu" role="menu">
                        <button
                          type="button"
                          className="session-item-menu-item"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation()
                            beginRename(session)
                          }}
                        >
                          <Pencil size={12} />
                          <span>重命名</span>
                        </button>
                        {(() => {
                          const otherFolders = conversationFolders.filter(
                            (folder) => folder.id !== session.projectId
                          )
                          const canReturnToFree = Boolean(session.projectId)
                          if (otherFolders.length === 0 && !canReturnToFree) return null
                          return (
                            <div className="session-item-menu-group">
                              <div className="session-item-menu-label">
                                <FolderInput size={12} />
                                <span>移动到</span>
                              </div>
                              {canReturnToFree ? (
                                <button
                                  type="button"
                                  className="session-item-menu-item session-item-menu-item-nested"
                                  role="menuitem"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    closeSessionMenu()
                                    void handleMoveSession(session.id, undefined)
                                  }}
                                >
                                  <MessageSquarePlus size={12} />
                                  <span>自由对话</span>
                                </button>
                              ) : null}
                              {otherFolders.map((folder) => (
                                <button
                                  key={folder.id}
                                  type="button"
                                  className="session-item-menu-item session-item-menu-item-nested"
                                  role="menuitem"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    closeSessionMenu()
                                    void handleMoveSession(session.id, folder.id)
                                  }}
                                >
                                  <Library size={12} />
                                  <span>{folder.name}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                        <button
                          type="button"
                          className="session-item-menu-item danger"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeSessionMenu()
                            void handleDeleteSession(session.id)
                          }}
                        >
                          <Trash2 size={12} />
                          <span>删除</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="sidebar-model-card">
        <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
        <div className="sidebar-model-text">
          <span>{activeProviderName}</span>
          <strong>{activeModelName}</strong>
        </div>
      </div>

      {pendingDeleteProject ? (
        <ProjectDeleteModal
          project={pendingDeleteProject}
          sessionCount={projectSessionCounts.get(pendingDeleteProject.id) || 0}
          onClose={() => setPendingDeleteProjectId(null)}
          onConfirm={(choice: ProjectDeleteChoice) => {
            const projectId = pendingDeleteProject.id
            setPendingDeleteProjectId(null)
            void onDeleteProject(projectId, {
              deleteSessions: choice === 'delete-sessions'
            })
          }}
        />
      ) : null}
    </aside>
  )
}

export const SessionSidebar = React.memo(SessionSidebarComponent)
SessionSidebar.displayName = 'SessionSidebar'
