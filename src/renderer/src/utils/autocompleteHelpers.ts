import { AutocompleteItem } from '../../../shared/types'

export interface PopupOption {
  label: string
  payload:
    | boolean
    | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
}

export function getCommandPrefixes(command: string): string[] {
  if (!command) return []
  // Split chained commands (`cd "x" && type "y"`) so each independently-executed part can be
  // approved on its own. The main process enforces the authoritative segment-aware check; this
  // just surfaces a button per segment so the user can grant `cd`, `type`, `findstr`, etc.
  const segments = command
    .split(/(?:&&|\|\||[;|&\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const prefixes: string[] = []
  const push = (p: string): void => {
    if (p && !prefixes.includes(p) && prefixes.length < 6) prefixes.push(p)
  }
  for (const segment of segments) {
    const tokens = segment.split(/\s+/).filter((t) => !t.startsWith('-'))
    if (tokens.length === 0) continue
    push(tokens[0])
    // Only offer a two-word prefix when the subcommand is a clean alphanumeric word (no paths).
    if (tokens.length > 1 && /^[a-zA-Z0-9_-]+$/.test(tokens[1])) {
      push(`${tokens[0]} ${tokens[1]}`)
    }
  }
  return prefixes
}

export function getPopupOptions(
  pending: { toolName: string; args: unknown } | null
): PopupOption[] {
  if (!pending) return []

  const options: PopupOption[] = [
    { label: '允许本次执行 (Yes, allow this time)', payload: { approved: true } },
    {
      label: `在此任务中允许所有 "${pending.toolName}" 工具的调用`,
      payload: { approved: true, scope: 'tool', tool: pending.toolName }
    }
  ]

  if (pending.toolName === 'shell' && pending.args && typeof pending.args === 'object') {
    const argsObj = pending.args as Record<string, unknown>
    const command = typeof argsObj.command === 'string' ? argsObj.command : ''
    const prefixes = getCommandPrefixes(command)
    for (const prefix of prefixes) {
      options.push({
        label: `在此任务中允许所有 "${prefix}" 开头的命令`,
        payload: { approved: true, scope: 'prefix', prefix }
      })
    }
  }

  options.push({ label: '拒绝执行 (No)', payload: { approved: false } })
  return options
}

export const commandText: Record<string, { title: string; description: string }> = {
  new: { title: '新对话', description: '开始一个空白对话' },
  clear: { title: '清空当前对话', description: '移除当前对话里的消息' },
  settings: { title: '设置', description: '打开模型、服务商和应用设置' },
  help: { title: '帮助', description: '显示快捷命令说明' },
  exit: { title: '隐藏面板', description: '收起 QuickAI 窗口' }
}

export const autocompleteTypeOrder: AutocompleteItem['type'][] = [
  'command',
  'skill',
  'model',
  'provider',
  'session',
  'delete-session'
]

export const autocompleteGroupLabels: Record<AutocompleteItem['type'], string> = {
  command: '命令',
  skill: '技能',
  model: '模型',
  provider: '服务商',
  session: '历史对话',
  'delete-session': '删除对话'
}

const emojiPattern =
  /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g

function cleanAutocompleteText(value: string): string {
  return value.replace(emojiPattern, '').replace(/\s+/g, ' ').trim()
}

function splitAutocompleteName(value: string): { title: string; description: string } {
  const clean = cleanAutocompleteText(value)
  const parts = clean.split(/\s+-\s+/)
  return {
    title: parts[0] || clean,
    description: parts.slice(1).join(' - ')
  }
}

export function getAutocompleteTitle(item: AutocompleteItem): string {
  if (item.type === 'command' && item.cmd && commandText[item.cmd]) {
    return commandText[item.cmd].title
  }
  if (item.type === 'model') return item.modelId || splitAutocompleteName(item.name).title
  if (item.type === 'provider')
    return splitAutocompleteName(item.name).title.replace(/^切换服务商\s*/, '')
  if (item.type === 'delete-session') {
    return splitAutocompleteName(item.name).title.replace(/^删除会话[:：]?\s*/, '')
  }
  return splitAutocompleteName(item.name).title
}

export function getAutocompleteDescription(item: AutocompleteItem): string {
  if (item.type === 'command' && item.cmd && commandText[item.cmd]) {
    return commandText[item.cmd].description
  }
  const split = splitAutocompleteName(item.name)
  if (item.type === 'skill') return split.description || '插入或运行自定义技能'
  if (item.type === 'model') return '切换当前模型'
  if (item.type === 'provider') return '切换当前服务商'
  if (item.type === 'session') return '打开历史对话'
  if (item.type === 'delete-session') return '删除这个历史对话'
  return split.description
}

export function getAutocompleteMeta(item: AutocompleteItem): string {
  if (item.type === 'skill') {
    if (item.skillMode === 'run') return '运行'
    if (item.skillMode === 'send') return '发送'
    return '插入'
  }
  return autocompleteGroupLabels[item.type]
}

export function groupAutocompleteItems(items: AutocompleteItem[]): Array<{
  type: AutocompleteItem['type']
  label: string
  items: Array<{ item: AutocompleteItem; index: number }>
}> {
  const indexedItems = items.map((item, index) => ({ item, index }))

  return autocompleteTypeOrder
    .map((type) => ({
      type,
      label: autocompleteGroupLabels[type],
      items: indexedItems.filter(({ item }) => item.type === type)
    }))
    .filter((group) => group.items.length > 0)
}

export function getArgsText(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const argsObj = args as Record<string, unknown>
  if (toolName === 'fetch_url') {
    return `URL: ${argsObj.url || ''}`
  }
  if (toolName === 'file_read') {
    return `文件路径: ${argsObj.path || ''}${argsObj.offset ? ` (起始行: ${argsObj.offset})` : ''}`
  }
  if (toolName === 'workspace_search') {
    return `搜索内容: "${argsObj.query || ''}"${argsObj.glob ? ` (匹配模式: ${argsObj.glob})` : ''}`
  }
  if (toolName === 'web_search') {
    return `搜索关键词: "${argsObj.query || ''}"`
  }
  return JSON.stringify(args)
}

export function formatSessionStamp(timestamp: number | undefined, id: string): string {
  const value = timestamp || Number(id)
  if (!Number.isFinite(value)) return ''
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
