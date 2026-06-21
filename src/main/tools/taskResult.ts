import { TaskItem } from '../../shared/types'
import { createToolResult } from './result'
import { ToolExecutionResult } from './types'

const STATUS_LABEL: Record<TaskItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '✕'
}

export function createTaskToolResult(tasks: TaskItem[]): ToolExecutionResult {
  const lines = ['Tasks:']
  for (const task of tasks) {
    lines.push(`  ${STATUS_LABEL[task.status] || '○'} ${task.id}: ${task.title} [${task.status}]`)
  }

  const doneCount = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'cancelled'
  ).length
  const total = tasks.length

  return createToolResult({
    resultForModel: `${lines.join('\n')}\n\nProgress: ${doneCount}/${total} done. Update task statuses with this tool as you complete each step. Use completed only after the underlying work is actually performed and verified; leave unfinished or unverified work pending/in_progress/cancelled.`,
    title: 'Tasks',
    summary: `${doneCount}/${total} done`
  })
}
