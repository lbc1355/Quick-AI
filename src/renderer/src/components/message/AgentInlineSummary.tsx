import React from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import type { TaskItem } from '../../../../shared/types'

type AgentStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'max_steps'
  | 'safety_stop'

interface AgentInlineSummaryProps {
  agentStatus: AgentStatus
  hasPendingToolCall: boolean
  cockpitColor: string
  statusText: string
  elapsed: number
  tasks: TaskItem[]
  opText: string
  toolsSummaryText: string
}

const TaskProgressLine = React.memo<{ tasks: TaskItem[] }>(({ tasks }) => {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.status === 'completed').length
  const inProgressTask = tasks.find((t) => t.status === 'in_progress')

  let currentTaskIdx = completedTasks + 1
  let currentTaskTitle = ''

  if (inProgressTask) {
    const idx = tasks.findIndex((t) => t.id === inProgressTask.id)
    if (idx !== -1) {
      currentTaskIdx = idx + 1
    }
    currentTaskTitle = inProgressTask.title
  } else {
    const pendingTask = tasks.find((t) => t.status === 'pending')
    if (pendingTask) {
      const idx = tasks.findIndex((t) => t.id === pendingTask.id)
      if (idx !== -1) {
        currentTaskIdx = idx + 1
      }
      currentTaskTitle = pendingTask.title
    } else {
      currentTaskIdx = completedTasks
      currentTaskTitle = tasks[tasks.length - 1]?.title || ''
    }
  }

  return (
    <div className="summary-task-progress-line">
      <span className="summary-task-progress-label">任务进度：</span>
      <span className="summary-task-progress-value">
        {currentTaskIdx}/{totalTasks} &ldquo;{currentTaskTitle}&rdquo;
      </span>
    </div>
  )
})

TaskProgressLine.displayName = 'TaskProgressLine'

export const AgentInlineSummary = React.memo<AgentInlineSummaryProps>(
  ({
    agentStatus,
    hasPendingToolCall,
    cockpitColor,
    statusText,
    elapsed,
    tasks,
    opText,
    toolsSummaryText
  }) => {
    return (
      <div
        className="agent-inline-summary-box"
        style={{
          borderColor: hasPendingToolCall ? 'var(--color-status-pending)' : undefined
        }}
      >
        <div className="summary-header">
          <div className="summary-title-wrapper">
            {agentStatus === 'running' || hasPendingToolCall ? (
              <Loader2
                size={12}
                className="animate-spin summary-status-icon"
                style={{ color: cockpitColor }}
              />
            ) : agentStatus === 'completed' ? (
              <Check size={12} className="summary-status-icon" style={{ color: cockpitColor }} />
            ) : (
              <AlertCircle
                size={12}
                className="summary-status-icon"
                style={{ color: cockpitColor }}
              />
            )}
            <span className="summary-status-text" style={{ color: cockpitColor }}>
              {statusText}
            </span>
            {agentStatus === 'running' && !hasPendingToolCall && (
              <span className="summary-timer">• {elapsed}s</span>
            )}
          </div>
        </div>

        <div className="summary-body">
          {tasks.length > 0 && <TaskProgressLine tasks={tasks} />}
          <div className="summary-current-op" title={opText}>
            {opText}
          </div>
          {toolsSummaryText && <div className="summary-tools-info">{toolsSummaryText}</div>}
        </div>
      </div>
    )
  },
  (prev, next) => {
    if (prev.agentStatus !== next.agentStatus) return false
    if (prev.hasPendingToolCall !== next.hasPendingToolCall) return false
    if (prev.cockpitColor !== next.cockpitColor) return false
    if (prev.statusText !== next.statusText) return false
    if (prev.elapsed !== next.elapsed) return false
    if (prev.opText !== next.opText) return false
    if (prev.toolsSummaryText !== next.toolsSummaryText) return false
    const prevTasks = prev.tasks
    const nextTasks = next.tasks
    if (prevTasks === nextTasks) return true
    if (prevTasks.length === 0 && nextTasks.length === 0) return true
    return false
  }
)

AgentInlineSummary.displayName = 'AgentInlineSummary'
