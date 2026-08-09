import React, { useEffect } from 'react'
import { Library, Folder, Trash2, X } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { isConversationFolder } from '../../../shared/projectHelpers'

export type ProjectDeleteChoice = 'keep-sessions' | 'delete-sessions'

interface ProjectDeleteModalProps {
  project: Project
  sessionCount: number
  onClose: () => void
  onConfirm: (choice: ProjectDeleteChoice) => void
}

export const ProjectDeleteModal: React.FC<ProjectDeleteModalProps> = ({
  project,
  sessionCount,
  onClose,
  onConfirm
}) => {
  const isFolder = isConversationFolder(project)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="tool-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="tool-detail-modal project-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tool-detail-header">
          <div className="tool-detail-title-group">
            {isFolder ? <Library size={15} /> : <Folder size={15} />}
            <strong id="project-delete-title">{isFolder ? '删除对话文件夹' : '移除项目'}</strong>
          </div>
          <button type="button" className="tool-detail-close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="tool-detail-body project-delete-body">
          <p className="project-delete-summary">
            {isFolder
              ? `确定删除对话文件夹「${project.name}」？`
              : `确定移除项目「${project.name}」？`}
          </p>
          <p className="project-delete-detail">
            {isFolder
              ? sessionCount > 0
                ? `文件夹内有 ${sessionCount} 个对话。选择「仅删除文件夹」时，这些对话会移到自由对话。`
                : '该文件夹内暂无对话。'
              : sessionCount > 0
                ? `磁盘文件不会被删除。其中 ${sessionCount} 个对话会保留为自由对话。`
                : '磁盘文件不会被删除。'}
          </p>
        </div>

        <div className="agent-file-revert-footer project-delete-footer">
          <button type="button" className="agent-file-revert-button secondary" onClick={onClose}>
            取消
          </button>
          {isFolder && sessionCount > 0 ? (
            <>
              <button
                type="button"
                className="agent-file-revert-button secondary"
                onClick={() => onConfirm('keep-sessions')}
              >
                仅删除文件夹
              </button>
              <button
                type="button"
                className="agent-file-revert-button danger"
                onClick={() => onConfirm('delete-sessions')}
              >
                <Trash2 size={14} />
                删除文件夹和对话
              </button>
            </>
          ) : (
            <button
              type="button"
              className="agent-file-revert-button danger"
              onClick={() => onConfirm('keep-sessions')}
            >
              <Trash2 size={14} />
              {isFolder ? '删除文件夹' : '移除项目'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
