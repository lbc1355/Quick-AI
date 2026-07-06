import React from 'react'
import {
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
  ArrowLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  MessageSquarePlus,
  Terminal
} from 'lucide-react'
import { Project, Session } from '../../../shared/types'
import {
  BranchFamilyInfo,
  BranchFamilyMemberInfo,
  getBranchDisplayInfo
} from '../utils/branchDisplay'
import { formatSessionStamp } from '../utils/autocompleteHelpers'

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
  activeProviderName: string
  activeModelName: string
  onAddProject: () => void
  onOpenProject: (projectId: string) => void
  onOpenFreeConversations: () => void
  onDeleteProject: (projectId: string) => void
  exitSessionFamilyView: () => void
  handleNewSession: () => Promise<Session>
  handleDeleteSession: (id: string) => Promise<void>
  openSession: (sessionId: string) => void
  setSessionFamilyRootId: (id: string | null) => void
  setDismissedSessionFamilyViewForId: (id: string | null) => void
  setAutocompleteItems: (items: never[]) => void
  onOpenBgShellManager: () => void
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
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
  activeProviderName,
  activeModelName,
  onAddProject,
  onOpenProject,
  onOpenFreeConversations,
  onDeleteProject,
  exitSessionFamilyView,
  handleNewSession,
  handleDeleteSession,
  openSession,
  setSessionFamilyRootId,
  setDismissedSessionFamilyViewForId,
  setAutocompleteItems,
  onOpenBgShellManager
}) => {
  const freeSessionCount = sessions.filter((session) => !session.projectId).length
  const startNewSession = (): void => {
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(null)
    void handleNewSession()
    setAutocompleteItems([])
  }

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
          {!isSidebarCollapsed && (
            <button
              type="button"
              className="sidebar-icon-btn"
              onClick={onOpenBgShellManager}
              title="后台进程管理"
            >
              <Terminal size={14} />
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
              <span>项目</span>
              <ChevronRight size={12} />
            </span>
            <button
              type="button"
              className="sidebar-mini-action"
              onClick={onAddProject}
              title="添加项目"
            >
              <FolderPlus size={12} />
            </button>
          </div>
          <div className="project-list">
            <div className="project-entry">
              <button
                type="button"
                className={`project-row ${activeProjectId ? '' : 'active'}`}
                onClick={onOpenFreeConversations}
                title="未绑定项目的自由对话"
              >
                <MessageSquarePlus size={13} />
                <span className="project-row-title">自由对话</span>
                <span className="project-row-count">{freeSessionCount}</span>
              </button>
            </div>
            {projects.length === 0 ? (
              <button
                type="button"
                className="project-row project-empty-row"
                onClick={onAddProject}
              >
                <FolderPlus size={13} />
                <span className="project-row-title">添加项目</span>
                <span className="project-row-count">+</span>
              </button>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="project-entry">
                  <button
                    type="button"
                    className={`project-row ${activeProjectId === project.id ? 'active' : ''}`}
                    onClick={() => onOpenProject(project.id)}
                    title={project.path}
                  >
                    <Folder size={13} />
                    <span className="project-row-title">{project.name}</span>
                    <span className="project-row-count">
                      {projectSessionCounts.get(project.id) || 0}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="project-delete-btn"
                    onClick={() => onDeleteProject(project.id)}
                    title="移除项目记录"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
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
                  className={`session-item ${isActive ? 'active' : ''} ${isBranchSession ? 'branch-session-item' : ''} ${familyMember?.isRoot ? 'family-root-session' : ''}`}
                >
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
                      className={`session-meta ${branchInfo || familyMember ? 'session-meta-with-branch' : ''}`}
                    >
                      {branchInfo || familyMember ? <GitBranch size={10} /> : null}
                      <span title={familyMeta || branchInfo?.sourceTitle || undefined}>
                        {sessionStamp}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-delete-btn"
                    onClick={() => void handleDeleteSession(session.id)}
                    title="删除对话"
                  >
                    <Trash2 size={12} />
                  </button>
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
    </aside>
  )
}
