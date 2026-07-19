import React, { useEffect } from 'react'
import { AlertTriangle, History, Loader2, RotateCcw, X } from 'lucide-react'
import type { AgentFileChangeKind, SessionFileTransitionPreview } from '../../../shared/types'

interface SessionRevertModalProps {
  mode: 'revert' | 'restore'
  preview: SessionFileTransitionPreview
  messageCount: number
  isApplying: boolean
  onClose: () => void
  onConfirm: () => void
}

const kindLabel: Record<AgentFileChangeKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除'
}

export const SessionRevertModal: React.FC<SessionRevertModalProps> = ({
  mode,
  preview,
  messageCount,
  isApplying,
  onClose,
  onConfirm
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isApplying) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isApplying, onClose])

  const restoring = mode === 'restore'
  const conflictAction = restoring ? '恢复' : '回退'

  return (
    <div className="tool-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="tool-detail-modal agent-file-revert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-revert-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tool-detail-header">
          <div className="tool-detail-title-group">
            <History size={15} />
            <strong id="session-revert-title">
              {restoring ? '恢复已撤回内容' : '撤回这条请求'}
            </strong>
          </div>
          <button className="tool-detail-close" onClick={onClose} disabled={isApplying}>
            <X size={15} />
          </button>
        </div>

        <div className="tool-detail-body agent-file-revert-body">
          <p className="agent-file-revert-summary">
            {restoring
              ? `将恢复 ${messageCount} 条暂存消息，并重新应用 ${preview.files.length} 个文件的 Agent 修改。`
              : `将撤回这条用户消息及其后续共 ${messageCount} 条消息，并撤销 ${preview.files.length} 个文件的 Agent 修改。`}
          </p>

          {preview.conflicts.length > 0 && (
            <div className="agent-file-revert-warning">
              <AlertTriangle size={15} />
              <span>
                {preview.conflicts.length} 个文件包含时间线之外的后续修改。继续{conflictAction}
                会覆盖这些修改。
              </span>
            </div>
          )}

          {preview.files.length > 0 && (
            <div className="agent-file-revert-files">
              {preview.files.map((file) => (
                <div
                  key={file.path}
                  className={`agent-file-revert-file ${file.conflict ? 'conflict' : ''}`}
                >
                  <span className={`agent-file-change-kind ${file.kind}`}>
                    {kindLabel[file.kind]}
                  </span>
                  <code>{file.path}</code>
                  {file.conflict && <span className="agent-file-conflict-label">后续有修改</span>}
                </div>
              ))}
            </div>
          )}

          {preview.diff && (
            <section className="tool-detail-section">
              <h4>{restoring ? '恢复预览' : '回退预览'}</h4>
              <pre className="tool-detail-code agent-file-revert-diff">{preview.diff}</pre>
            </section>
          )}
        </div>

        <div className="agent-file-revert-footer">
          <button
            className="agent-file-revert-button secondary"
            onClick={onClose}
            disabled={isApplying}
          >
            取消
          </button>
          <button
            className={`agent-file-revert-button ${preview.conflicts.length > 0 ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={isApplying}
          >
            {isApplying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {preview.conflicts.length > 0
              ? `覆盖后续修改并${conflictAction}`
              : restoring
                ? '确认恢复会话'
                : '确认回退会话'}
          </button>
        </div>
      </div>
    </div>
  )
}
