import { TaskItem } from '../../shared/types'

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

export function normalizeTaskArgs(args: unknown): TaskItem[] {
  const source = pickTaskSource(args)
  const entries = expandTaskSource(source)
  const fallbackStatus = entries.length === 1 ? 'in_progress' : 'pending'
  return entries
    .map((item, index) => normalizeTaskEntry(item, index, fallbackStatus))
    .filter((item): item is TaskItem => Boolean(item))
}
