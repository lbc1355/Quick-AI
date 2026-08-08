import React from 'react'
import { Check, Copy, Edit, History, Play, RefreshCw, Undo2, X } from 'lucide-react'

interface MessageActionsProps {
  align?: 'flex-start' | 'flex-end'
  canEdit: boolean
  canRegenerate: boolean
  canResume: boolean
  canRevertFiles?: boolean
  canRevertSession?: boolean
  canCancelQueued?: boolean
  cancellingQueued?: boolean
  filesReverted?: boolean
  canCopy?: boolean
  copied: boolean
  onCopy: () => void
  onEdit: () => void
  onRegenerate: () => void
  onResume: () => void
  onRevertFiles?: () => void
  onRevertSession?: () => void
  onCancelQueued?: () => void
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  align = 'flex-start',
  canEdit,
  canRegenerate,
  canResume,
  canRevertFiles = false,
  canRevertSession = false,
  canCancelQueued = false,
  cancellingQueued = false,
  filesReverted = false,
  canCopy = false,
  copied,
  onCopy,
  onEdit,
  onRegenerate,
  onResume,
  onRevertFiles,
  onRevertSession,
  onCancelQueued
}) => {
  if (
    !canEdit &&
    !canRegenerate &&
    !canResume &&
    !canCopy &&
    !canRevertFiles &&
    !canRevertSession &&
    !canCancelQueued
  )
    return null

  return (
    <div className="message-actions" style={{ justifyContent: align }}>
      {canCancelQueued && (
        <button
          className="msg-action-btn"
          onClick={onCancelQueued}
          disabled={cancellingQueued}
          title="取消这条尚未开始执行的排队消息"
        >
          <X size={10} />
          <span>{cancellingQueued ? '取消中…' : '取消排队'}</span>
        </button>
      )}
      {canEdit && (
        <button className="msg-action-btn" onClick={onEdit}>
          <Edit size={10} />
          <span>编辑</span>
        </button>
      )}
      {canResume && (
        <button className="msg-action-btn" onClick={onResume}>
          <Play size={10} />
          <span>继续执行</span>
        </button>
      )}
      {canRegenerate && (
        <button className="msg-action-btn" onClick={onRegenerate}>
          <RefreshCw size={10} />
          <span>重新生成</span>
        </button>
      )}
      {canRevertFiles && (
        <button
          className="msg-action-btn"
          onClick={onRevertFiles}
          disabled={filesReverted}
          title={filesReverted ? '文件修改已撤销' : '查看并撤销该次 Agent 运行的文件修改'}
        >
          {filesReverted ? <Check size={10} /> : <Undo2 size={10} />}
          <span>{filesReverted ? '已撤销文件' : '撤销文件修改'}</span>
        </button>
      )}
      {canRevertSession && (
        <button
          className="msg-action-btn"
          onClick={onRevertSession}
          title="撤回这条用户消息及其后续内容"
        >
          <History size={10} />
          <span>撤回请求</span>
        </button>
      )}
      {canCopy && (
        <button className="msg-action-btn" onClick={onCopy}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      )}
    </div>
  )
}
