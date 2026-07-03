import { AutocompleteItem } from '../../../shared/types'

export interface PopupOption {
  label: string
  payload:
    | boolean
    | {
        approved: boolean
        scope?: 'prefix' | 'tool'
        prefix?: string
        prefixes?: string[]
        tool?: string
      }
}

export interface PermissionRequestDisplay {
  question: string
  toolLabel: string
  action: string
  target?: string
  details: string[]
  code?: string
}

function splitCommandSegmentsRenderer(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    const next = command[i + 1]

    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    // Two-char operators.
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(current)
      current = ''
      i++
      continue
    }
    // Single-char separators.
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map((s) => s.trim()).filter((s) => s.length > 0)
}

function describeShellCommand(command: string): PermissionRequestDisplay {
  return {
    question: '是否允许执行这个 Shell 命令？',
    toolLabel: 'Shell',
    action: '执行 Shell 命令',
    details: [],
    code: command
  }
}

export function getPermissionRequestDisplay(
  toolName: string,
  args: unknown
): PermissionRequestDisplay {
  if (
    (toolName === 'shell' || toolName === 'shell_background_start') &&
    args &&
    typeof args === 'object'
  ) {
    const command = (args as Record<string, unknown>).command
    if (typeof command === 'string' && command.trim()) {
      return describeShellCommand(command.trim())
    }
  }

  let target: string | undefined = undefined
  if (args && typeof args === 'object' && args !== null) {
    const obj = args as Record<string, unknown>
    const possibleTargets = [
      'path',
      'Path',
      'targetFile',
      'TargetFile',
      'absolutePath',
      'AbsolutePath',
      'url',
      'Url',
      'target',
      'Target'
    ]
    for (const key of possibleTargets) {
      if (typeof obj[key] === 'string' && obj[key]) {
        target = obj[key] as string
        break
      }
    }
  }

  const argsText = getArgsText(toolName, args)
  return {
    question: '是否允许执行这个工具？',
    toolLabel: toolName,
    action: `调用工具：${toolName}`,
    target,
    details: argsText ? [argsText] : [],
    code: argsText
  }
}

/**
 * Per-segment leading prefixes for a (possibly chained) command. Returns one entry per
 * independently-executed segment, in order, de-duplicated. `cd "x" && dir && type "y"` →
 * ['cd', 'dir', 'type']. Used to decide approval granularity in getPopupOptions.
 */
export function getSegmentPrefixes(command: string): string[] {
  if (!command) return []
  const segments = splitCommandSegmentsRenderer(command)
  const prefixes: string[] = []
  for (const segment of segments) {
    const firstToken = segment.split(/\s+/)[0]
    if (firstToken && !prefixes.includes(firstToken)) prefixes.push(firstToken)
  }
  return prefixes
}

/**
 * Approval-button prefixes for a SINGLE-segment command. Offers the leading word plus, when the
 * subcommand is a clean alphanumeric word, the two-word prefix (e.g. `git` and `git status`).
 * Only meaningful for single commands — chained commands are collapsed into one combined option
 * by getPopupOptions to avoid flooding the popup with one prefix per segment.
 */
export function getCommandPrefixes(command: string): string[] {
  if (!command) return []
  const segments = splitCommandSegmentsRenderer(command)
  const prefixes: string[] = []
  const push = (p: string): void => {
    if (p && !prefixes.includes(p) && prefixes.length < 6) prefixes.push(p)
  }
  for (const segment of segments) {
    const tokens = segment.split(/\s+/)
    if (tokens.length === 0) continue
    const firstToken = tokens[0]
    push(firstToken)
    // Only offer a two-word prefix when the subcommand is a clean alphanumeric word (no paths, no flags).
    if (tokens.length > 1) {
      const secondToken = tokens[1]
      if (
        !secondToken.startsWith('-') &&
        !secondToken.startsWith('/') &&
        /^[a-zA-Z0-9_-]+$/.test(secondToken)
      ) {
        push(`${firstToken} ${secondToken}`)
      }
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

  if (
    (pending.toolName === 'shell' || pending.toolName === 'shell_background_start') &&
    pending.args &&
    typeof pending.args === 'object'
  ) {
    const argsObj = pending.args as Record<string, unknown>
    const command = typeof argsObj.command === 'string' ? argsObj.command : ''
    const segmentPrefixes = getSegmentPrefixes(command)

    if (segmentPrefixes.length > 1) {
      // Chained command: collapse into ONE option that approves every segment's prefix at once,
      // instead of emitting a separate button per segment (which floods the popup).
      options.push({
        label: `允许此命令的所有指令 (${segmentPrefixes.join('、')})`,
        payload: { approved: true, scope: 'prefix', prefixes: segmentPrefixes }
      })
    } else {
      // Single command: keep finer granularity, including the two-word prefix (e.g. `git status`).
      for (const prefix of getCommandPrefixes(command)) {
        options.push({
          label: `在此任务中允许所有 "${prefix}" 开头的命令`,
          payload: { approved: true, scope: 'prefix', prefix }
        })
      }
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
  if (item.type === 'skill')
    return split.description || 'Mention this Skill; the agent will load it'
  if (item.type === 'model') return '切换当前模型'
  if (item.type === 'provider') return '切换当前服务商'
  if (item.type === 'session') return '打开历史对话'
  if (item.type === 'delete-session') return '删除这个历史对话'
  return split.description
}

export function getAutocompleteMeta(item: AutocompleteItem): string {
  if (item.type === 'skill') {
    return 'Skill'
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
  if (Object.keys(argsObj).length === 0) return ''
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
