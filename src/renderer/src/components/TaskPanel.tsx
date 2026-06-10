import React from 'react'
import { ListTodo, ChevronRight, CheckCircle2, XCircle, Circle, Loader2 } from 'lucide-react'
import { TaskItem } from '../../../shared/types'

interface TaskPanelProps {
  tasks: TaskItem[]
  onClose: () => void
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ tasks, onClose }) => {
  return (
    <aside className="task-panel">
      <div className="task-panel-header">
        <div className="task-panel-title">
          <ListTodo size={14} style={{ color: 'var(--color-primary)' }} />
          <span>任务进度</span>
        </div>
        <button type="button" className="sidebar-icon-btn" onClick={onClose} title="收起面板">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="task-panel-content">
        <div className="task-items-list">
          {tasks.map((t) => {
            let statusIcon = (
              <Circle size={13} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
            )
            if (t.status === 'in_progress') {
              statusIcon = (
                <Loader2
                  size={13}
                  className="animate-spin"
                  style={{ color: 'var(--color-primary)' }}
                />
              )
            } else if (t.status === 'completed') {
              statusIcon = <CheckCircle2 size={13} style={{ color: '#10b981' }} />
            } else if (t.status === 'cancelled') {
              statusIcon = <XCircle size={13} style={{ color: '#ef4444', opacity: 0.8 }} />
            }

            return (
              <div key={t.id} className={`task-item-row ${t.status}`}>
                <span className="task-item-status-icon">{statusIcon}</span>
                <span className="task-item-title">{t.title}</span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
