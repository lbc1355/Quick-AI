import React from 'react'
import {
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
  ArrowLeft,
  Folder,
  MessageSquarePlus
} from 'lucide-react'
import { Session } from '../../../shared/types'
import {
  BranchFamilyInfo,
  BranchFamilyMemberInfo,
  getBranchDisplayInfo
} from '../utils/branchDisplay'
import { formatSessionStamp } from '../utils/autocompleteHelpers'

interface SessionSidebarProps {
  sessions: Session[]
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
  exitSessionFamilyView: () => void
  handleNewSession: () => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  openSession: (sessionId: string) => void
  setSessionFamilyRootId: (id: string | null) => void
  setDismissedSessionFamilyViewForId: (id: string | null) => void
  setAutocompleteItems: (items: never[]) => void
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  activeSessionId,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  visibleSessionFamilyInfo,
  visibleSessionEntries,
  isGenerating,
  activeProviderName,
  activeModelName,
  exitSessionFamilyView,
  handleNewSession,
  handleDeleteSession,
  openSession,
  setSessionFamilyRootId,
  setDismissedSessionFamilyViewForId,
  setAutocompleteItems
}) => {
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
        {visibleSessionFamilyInfo && (
          <div className="sidebar-section project-section">
            <div className="sidebar-section-header">
              <span>项目</span>
              <span>派生视图</span>
            </div>
            <button
              type="button"
              className="project-row active"
              onClick={() => {
                setSessionFamilyRootId(null)
                setDismissedSessionFamilyViewForId(null)
              }}
              title={visibleSessionFamilyInfo.rootTitle}
            >
              <Folder size={13} />
              <span className="project-row-title">{visibleSessionFamilyInfo.rootTitle}</span>
              <span className="project-row-count">{visibleSessionEntries.length}</span>
            </button>
          </div>
        )}

        <div className="sidebar-section conversation-section">
          <div className="sidebar-section-header">
            <span>对话</span>
            {visibleSessionFamilyInfo && <span>派生</span>}
          </div>

          {!visibleSessionFamilyInfo && (
            <button
              type="button"
              className="project-row new-conversation-row"
              onClick={() => {
                setSessionFamilyRootId(null)
                setDismissedSessionFamilyViewForId(null)
                void handleNewSession()
                setAutocompleteItems([])
              }}
              title="新对话"
            >
              <MessageSquarePlus size={13} />
              <span className="project-row-title">新对话</span>
              <span className="project-row-count">Ctrl N</span>
            </button>
          )}

          {visibleSessionEntries.map(({ session, familyMember }) => {
            const isActive = session.id === activeSessionId
            const messageCount = session.messages.length
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
                    {familyMember ? (
                      <>
                        <GitBranch size={10} />
                        <span className="session-branch-source">{familyMeta}</span>
                        <span className="session-meta-divider">·</span>
                      </>
                    ) : (
                      branchInfo && (
                        <>
                          <GitBranch size={10} />
                          <span className="session-branch-source">{branchInfo.sourceTitle}</span>
                          <span className="session-meta-divider">·</span>
                        </>
                      )
                    )}
                    <span>
                      {messageCount} msg{messageCount === 1 ? '' : 's'} ·{' '}
                      {formatSessionStamp(session.lastActiveTime, session.id)}
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
