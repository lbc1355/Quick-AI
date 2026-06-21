import type { Message } from '../../../../shared/types'
import type { ParsedToolCall } from '../../utils/messageFormat'

type ToolArgsRecord = Record<string, unknown>

const isToolArgsRecord = (args: unknown): args is ToolArgsRecord =>
  typeof args === 'object' && args !== null

const getStringArg = (args: ToolArgsRecord, keys: string[]): string => {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export const formatToolArgsSummary = (toolName: string, args: unknown): string => {
  if (!isToolArgsRecord(args)) return ''
  const name = toolName.toLowerCase()
  if (name.includes('command') || name.includes('shell') || name.includes('run')) {
    const cmd = getStringArg(args, ['CommandLine', 'command', 'cmd'])
    if (cmd) {
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
    }
  }
  const path = getStringArg(args, [
    'path',
    'TargetFile',
    'AbsolutePath',
    'Target',
    'file',
    'filePath'
  ])
  if (path) {
    const parts = path.replace(/\\/g, '/').split('/')
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : path
  }
  const query = getStringArg(args, ['query', 'q'])
  if (query) {
    return `"${query.length > 40 ? query.substring(0, 40) + '...' : query}"`
  }
  const url = getStringArg(args, ['url', 'Url', 'uri'])
  if (url) {
    const displayUrl = url.replace(/^https?:\/\/(www\.)?/, '')
    return displayUrl.length > 40 ? displayUrl.substring(0, 40) + '...' : displayUrl
  }
  const keyVal = Object.entries(args)
    .filter(([k]) => k !== 'purpose')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ')
  if (!keyVal) return ''
  return keyVal.length > 50 ? `{${keyVal.substring(0, 50)}...}` : `{${keyVal}}`
}

export const getShellCommandArg = (toolName: string, args: unknown): string => {
  if (!isToolArgsRecord(args)) return ''
  const name = toolName.toLowerCase()
  if (!name.includes('command') && !name.includes('shell') && !name.includes('run')) return ''
  return getStringArg(args, ['CommandLine', 'command', 'cmd'])
}

export const formatToolDisplayText = (
  toolName: string,
  args: unknown,
  purpose?: string
): string => {
  const summary = purpose || formatToolArgsSummary(toolName, args)
  return summary ? `${toolName} ${summary}` : toolName
}

export const getToolArgsJson = (args: unknown): string => {
  if (!isToolArgsRecord(args)) return ''
  const cleanArgs = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'purpose'))
  return Object.keys(cleanArgs).length > 0 ? JSON.stringify(cleanArgs, null, 2) : ''
}

export const getToolStatusLabel = (status: ParsedToolCall['status']): string => {
  switch (status) {
    case 'completed':
      return '已完成'
    case 'running':
      return '运行中'
    case 'pending':
      return '等待中'
    case 'denied':
      return '已拒绝'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

export const formatCacheHitRate = (cacheStats: Message['cacheStats']): string | null => {
  if (!cacheStats || cacheStats.hasCacheStats === false || !Number.isFinite(cacheStats.hitRate)) {
    return null
  }
  return `缓存命中 ${cacheStats.hitRate}%`
}
