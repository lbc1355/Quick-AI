import React from 'react'
import { Check, Copy, Edit, Play, RefreshCw } from 'lucide-react'

interface MessageActionsProps {
  align?: 'flex-start' | 'flex-end'
  canEdit: boolean
  canRegenerate: boolean
  canResume: boolean
  canCopy?: boolean
  copied: boolean
  onCopy: () => void
  onEdit: () => void
  onRegenerate: () => void
  onResume: () => void
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  align = 'flex-start',
  canEdit,
  canRegenerate,
  canResume,
  canCopy = false,
  copied,
  onCopy,
  onEdit,
  onRegenerate,
  onResume
}) => {
  if (!canEdit && !canRegenerate && !canResume && !canCopy) return null

  return (
    <div className="message-actions" style={{ justifyContent: align }}>
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
      {canCopy && (
        <button className="msg-action-btn" onClick={onCopy}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      )}
    </div>
  )
}
