import React, { useEffect } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, X } from 'lucide-react'
import type { AgentFileChangeKind, AgentFileRevertPreview } from '../../../shared/types'

interface AgentFileRevertModalProps {
  preview: AgentFileRevertPreview
  isApplying: boolean
  onClose: () => void
  onConfirm: () => void
}

const kindLabel: Record<AgentFileChangeKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除'
}

export const AgentFileRevertModal: React.FC<AgentFileRevertModalProps> = ({
  preview,
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

  return (
    <div className="tool-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="tool-detail-modal agent-file-revert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-file-revert-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tool-detail-header">
          <div className="tool-detail-title-group">
            <RotateCcw size={15} />
            <strong id="agent-file-revert-title">撤销 Agent 文件修改</strong>
          </div>
          <button className="tool-detail-close" onClick={onClose} disabled={isApplying}>
            <X size={15} />
          </button>
        </div>

        <div className="tool-detail-body agent-file-revert-body">
          <p className="agent-file-revert-summary">
            将以下 {preview.files.length} 个文件恢复到本次 Agent 运行开始前的状态。
          </p>

          {preview.conflicts.length > 0 && (
            <div className="agent-file-revert-warning">
              <AlertTriangle size={15} />
              <span>
                {preview.conflicts.length} 个文件在该次运行后又被修改。继续会覆盖这些后续修改。
              </span>
            </div>
          )}

          {preview.alreadyReverted && (
            <div className="agent-file-revert-restored">
              <Check size={15} />
              <span>这些文件已经处于运行前状态，无需再次撤销。</span>
            </div>
          )}

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

          {preview.diff && (
            <section className="tool-detail-section">
              <h4>恢复预览</h4>
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
            disabled={isApplying || preview.alreadyReverted}
          >
            {isApplying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {preview.conflicts.length > 0 ? '覆盖后续修改并撤销' : '确认撤销文件修改'}
          </button>
        </div>
      </div>
    </div>
  )
}
