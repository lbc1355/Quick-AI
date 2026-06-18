import { TaskItem, ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { ToolDefinition, ToolExecutionContext } from './types'

const TASK_STATUSES: TaskItem['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const MAX_TASK_TITLE_LENGTH = 160

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTaskStatus(value: unknown, fallback: TaskItem['status']): TaskItem['status'] {
  return typeof value === 'string' && (TASK_STATUSES as string[]).includes(value)
    ? (value as TaskItem['status'])
    : fallback
}

function makeTaskId(title: string, index: number): string {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  return id || `task-${index + 1}`
}

function stripMarkdownJsonFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

function tryParseTaskJsonString(value: string): { jsonLike: boolean; parsed?: unknown } {
  const trimmed = stripMarkdownJsonFence(value)
  const jsonLike = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!jsonLike) return { jsonLike: false }
  try {
    return { jsonLike: true, parsed: JSON.parse(trimmed) }
  } catch {
    return { jsonLike: true }
  }
}

function isUnsafeTaskTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return true
  if (trimmed.length > MAX_TASK_TITLE_LENGTH) return true
  if (/[\r\n]/.test(trimmed)) return true
  if (/^```/.test(trimmed)) return true
  if (/^task\s*\(/i.test(trimmed)) return true
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return true
  if (/"(?:tasks?|status|title|id)"\s*:/.test(trimmed)) return true
  return false
}

function pickTaskSource(args: unknown): unknown {
  if (Array.isArray(args) || typeof args === 'string') return args
  if (!isRecord(args)) return undefined
  if (args.tasks !== undefined) return args.tasks
  if (args.task !== undefined) return args.task
  if (args.items !== undefined) return args.items
  if (
    args.title !== undefined ||
    args.description !== undefined ||
    args.id !== undefined ||
    args.status !== undefined
  ) {
    return args
  }
  return undefined
}

function expandTaskSource(source: unknown): unknown[] {
  if (typeof source === 'string') {
    const parsed = tryParseTaskJsonString(source)
    if (parsed.jsonLike) {
      if (parsed.parsed === undefined) return []
      const parsedSource = pickTaskSource(parsed.parsed)
      return expandTaskSource(parsedSource ?? parsed.parsed)
    }
    return [source]
  }
  if (Array.isArray(source)) return source
  return source !== undefined ? [source] : []
}

function normalizeTaskEntry(
  item: unknown,
  index: number,
  fallbackStatus: TaskItem['status']
): TaskItem | undefined {
  if (typeof item === 'string') {
    const title = item.trim()
    if (isUnsafeTaskTitle(title)) return undefined
    return {
      id: makeTaskId(title, index),
      title,
      status: fallbackStatus
    }
  }

  if (!isRecord(item)) return undefined

  const titleValue = item.title ?? item.description ?? item.task ?? item.name ?? item.id
  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  if (isUnsafeTaskTitle(title)) return undefined

  const rawId = typeof item.id === 'string' ? item.id.trim() : ''
  return {
    id: rawId || makeTaskId(title, index),
    title,
    status: readTaskStatus(item.status, fallbackStatus)
  }
}

function normalizeTaskArgs(args: unknown): TaskItem[] {
  const source = pickTaskSource(args)
  const entries = expandTaskSource(source)
  const fallbackStatus = entries.length === 1 ? 'in_progress' : 'pending'
  return entries
    .map((item, index) => normalizeTaskEntry(item, index, fallbackStatus))
    .filter((item): item is TaskItem => Boolean(item))
}

export const taskTool: ToolDefinition = {
  name: 'task',
  title: 'Task Tracker',
  description:
    'Track progress on complex multi-step tasks. Create a structured task list at the start of non-trivial work and update individual step statuses as you go. The task list appears in the UI so the user can follow your progress. Tasks with duplicate IDs update the existing entry; new IDs are appended. Mark a task completed only after the underlying work has actually been performed.',
  tags: ['task', 'todo', 'plan', 'track', 'progress', '任务', '计划', '追踪'],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'Optional short single task title. Do not pass JSON, code, markdown, or a serialized task list here; use tasks for lists.'
      },
      title: {
        type: 'string',
        description:
          'Optional short single task title. Equivalent to task; useful when sending one task object.'
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description:
          'Optional status for a single task title. Defaults to in_progress for one task.'
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short stable id (e.g. "1", "search", "fix").' },
            title: { type: 'string', description: 'Brief description of this step.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              description: 'Current status.'
            }
          },
          required: ['id', 'title', 'status']
        },
        description:
          'The task list. Provide the COMPLETE list on first call; on subsequent calls only include items whose status changed. Use completed only after the work is actually done, not as a planning placeholder.'
      }
    }
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const incoming = normalizeTaskArgs(args)
    if (incoming.length === 0) {
      throw new Error(
        'No valid task items found. Expected { "tasks": [{ "id": "1", "title": "...", "status": "pending|in_progress|completed|cancelled" }] }, or a short single task title. Do not pass JSON/code as a task title.'
      )
    }

    const run = getRun(ctx.reqId)
    if (!run) {
      throw new Error('No active agent run - tasks are only available during an agent session.')
    }

    const merged = run.mergeTasks(incoming)

    // Push to the renderer so the task list renders in the conversation UI.
    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('chat-chunk', {
        reqId: ctx.reqId,
        event: { type: 'task_update', tasks: merged }
      })
    }

    const lines = ['Tasks:']
    const statusIcon: Record<string, string> = {
      pending: '○',
      in_progress: '◐',
      completed: '●',
      cancelled: '✕'
    }
    for (const task of merged) {
      lines.push(`  ${statusIcon[task.status] || '○'} ${task.id}: ${task.title} [${task.status}]`)
    }

    const doneCount = merged.filter(
      (task) => task.status === 'completed' || task.status === 'cancelled'
    ).length
    const total = merged.length

    return {
      resultForModel: `${lines.join('\n')}\n\nProgress: ${doneCount}/${total} done. Update task statuses with this tool as you complete each step. Use completed only after the underlying work is actually performed and verified; leave unfinished or unverified work pending/in_progress/cancelled.`,
      resultForUi: {
        title: 'Tasks',
        summary: `${doneCount}/${total} done`
      }
    }
  }
}
