import {
  CachePriorityRetainedRunRef,
  CacheShapeChangeReason,
  CacheShapeDiagnostics,
  ChatCompletionMessage,
  ChatToolDeclaration,
  ContextRetentionMode,
  PromptCacheStats
} from '../../shared/types'
import { estimateTokens } from '../../shared/tokenEstimator'
import { createHash } from 'crypto'

interface CacheShapeSnapshot {
  systemHash: string
  toolsHash: string
  prefixHash: string
  messageShapeHash: string
  messageContentHash: string
  roleShape: string[]
  messageHashes: string[]
  messageCharLengths: number[]
  contextRetentionMode: ContextRetentionMode
  retainedRunCount: number
  retainedRunHash: string
  messageCount: number
  toolSchemaTokens: number
  duplicateToolCallIds: string[]
}

export interface CaptureCacheShapeOptions {
  messages: ChatCompletionMessage[]
  toolsToDeclare?: ChatToolDeclaration[]
  contextRetentionMode?: ContextRetentionMode
  cachePriorityRetainedRuns?: CachePriorityRetainedRunRef[]
}

interface NormalizedToolDeclaration {
  name: string
  description: string
  parameters: ChatToolDeclaration['function']['parameters']
}

interface NormalizedMessageForHash {
  role: string
  content: ChatCompletionMessage['content'] | null
  name?: string
  tool_call_id?: string
  tool_calls: NonNullable<ChatCompletionMessage['tool_calls']>
}

const stableStringify = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value !== 'object') return JSON.stringify(value)

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

const shortHash = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)

const messageContentText = (message: ChatCompletionMessage): string => {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) return stableStringify(message.content)
  return ''
}

const systemPromptText = (messages: ChatCompletionMessage[]): string =>
  messages
    .filter((message) => message.role === 'system')
    .map(messageContentText)
    .join('\n')

const normalizeToolDeclarations = (
  toolsToDeclare: ChatToolDeclaration[] | undefined
): NormalizedToolDeclaration[] =>
  (toolsToDeclare || [])
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters || {}
    }))
    .sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name)
      if (a.description !== b.description) return a.description.localeCompare(b.description)
      return stableStringify(a.parameters).localeCompare(stableStringify(b.parameters))
    })

const buildRoleShape = (messages: ChatCompletionMessage[]): string[] =>
  messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const toolNames = message.tool_calls.map((toolCall) => toolCall.function.name).join(',')
      return `assistant(tool_calls:${message.tool_calls.length}:${toolNames})`
    }
    if (message.role === 'tool') {
      return `tool(${message.name || 'unknown'})`
    }
    return message.role
  })

const normalizeMessageForHash = (message: ChatCompletionMessage): NormalizedMessageForHash => ({
  role: message.role,
  content: message.content ?? null,
  name: message.name,
  tool_call_id: message.tool_call_id,
  tool_calls: (message.tool_calls || []).map((toolCall) => ({
    id: toolCall.id,
    type: toolCall.type,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    }
  }))
})

const serializeMessageForHash = (message: ChatCompletionMessage): string =>
  stableStringify(normalizeMessageForHash(message))

const buildMessageHashes = (messages: ChatCompletionMessage[]): string[] =>
  messages.map((message) => shortHash(normalizeMessageForHash(message)))

const buildMessageCharLengths = (messages: ChatCompletionMessage[]): number[] =>
  messages.map((message) => serializeMessageForHash(message).length)

const isMessageContentAppendOnly = (previous: string[], current: string[]): boolean => {
  if (previous.length > current.length) return false
  return previous.every((hash, index) => current[index] === hash)
}

const findFirstDifferentMessageIndex = (
  previous: string[],
  current: string[]
): number | undefined => {
  const compareLength = Math.min(previous.length, current.length)
  for (let index = 0; index < compareLength; index++) {
    if (previous[index] !== current[index]) return index
  }
  return previous.length === current.length ? undefined : compareLength
}

const estimateAddedMessageTokens = (addedMessageChars: number | undefined): number | undefined =>
  addedMessageChars === undefined ? undefined : Math.ceil(addedMessageChars / 4)

const findDuplicateToolCallIds = (messages: ChatCompletionMessage[]): string[] => {
  const counts = new Map<string, number>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const toolCall of message.tool_calls || []) {
        if (!toolCall.id) continue
        counts.set(toolCall.id, (counts.get(toolCall.id) || 0) + 1)
      }
    } else if (message.role === 'tool' && message.tool_call_id) {
      counts.set(message.tool_call_id, (counts.get(message.tool_call_id) || 0) + 1)
    }
  }

  // A normal OpenAI tool call appears exactly twice: once in assistant.tool_calls and once as
  // the matching tool result. More than that means retained native tool context was duplicated.
  return [...counts.entries()]
    .filter(([, count]) => count > 2)
    .map(([id]) => id)
    .sort()
}

const isRoleShapeAppendOnly = (previous: string[], current: string[]): boolean => {
  if (previous.length > current.length) return false
  return previous.every((role, index) => current[index] === role)
}

export function captureCacheShape(options: CaptureCacheShapeOptions): CacheShapeSnapshot {
  const contextRetentionMode = options.contextRetentionMode || 'default'
  const normalizedTools = normalizeToolDeclarations(options.toolsToDeclare)
  const roleShape = buildRoleShape(options.messages)
  const messageHashes = buildMessageHashes(options.messages)
  const messageCharLengths = buildMessageCharLengths(options.messages)
  const retainedRuns = (options.cachePriorityRetainedRuns || [])
    .map((ref) => ({ runId: ref.runId, assistantMessageIndex: ref.assistantMessageIndex }))
    .sort(
      (a, b) => a.runId.localeCompare(b.runId) || a.assistantMessageIndex - b.assistantMessageIndex
    )
  const systemText = systemPromptText(options.messages)
  const toolsText = stableStringify(normalizedTools)

  return {
    systemHash: shortHash(systemText),
    toolsHash: shortHash(normalizedTools),
    prefixHash: shortHash({ systemText, normalizedTools, contextRetentionMode }),
    messageShapeHash: shortHash(roleShape),
    messageContentHash: shortHash(messageHashes),
    roleShape,
    messageHashes,
    messageCharLengths,
    contextRetentionMode,
    retainedRunCount: retainedRuns.length,
    retainedRunHash: shortHash(retainedRuns),
    messageCount: options.messages.length,
    toolSchemaTokens: estimateTokens(toolsText),
    duplicateToolCallIds: findDuplicateToolCallIds(options.messages)
  }
}

export function compareCacheShape(
  previous: CacheShapeSnapshot | undefined,
  current: CacheShapeSnapshot,
  stats?: PromptCacheStats
): CacheShapeDiagnostics {
  const reasons: CacheShapeChangeReason[] = []
  const appendOnlyFromPrevious = previous
    ? isRoleShapeAppendOnly(previous.roleShape, current.roleShape)
    : undefined
  const contentAppendOnlyFromPrevious = previous
    ? isMessageContentAppendOnly(previous.messageHashes, current.messageHashes)
    : undefined
  const firstDifferentMessageIndex = previous
    ? findFirstDifferentMessageIndex(previous.messageHashes, current.messageHashes)
    : undefined
  const addedMessageCount =
    previous && contentAppendOnlyFromPrevious
      ? current.messageHashes.length - previous.messageHashes.length
      : undefined
  const addedMessageChars =
    previous && contentAppendOnlyFromPrevious
      ? current.messageCharLengths
          .slice(previous.messageHashes.length)
          .reduce((total, length) => total + length, 0)
      : undefined
  const addedMessageTokens = estimateAddedMessageTokens(addedMessageChars)

  if (previous) {
    if (previous.systemHash !== current.systemHash) reasons.push('system')
    if (previous.toolsHash !== current.toolsHash) reasons.push('tools')
    if (previous.contextRetentionMode !== current.contextRetentionMode) {
      reasons.push('context_retention')
    }
    if (appendOnlyFromPrevious === false) reasons.push('message_shape')
    const contentChangeAlreadyExplained = reasons.some((reason) =>
      ['system', 'tools', 'context_retention', 'message_shape'].includes(reason)
    )
    if (
      !contentChangeAlreadyExplained &&
      appendOnlyFromPrevious !== false &&
      contentAppendOnlyFromPrevious === false
    ) {
      reasons.push('message_content')
    }
  }

  if (current.duplicateToolCallIds.length > 0) reasons.push('tool_call_duplication')

  return {
    prefixHash: current.prefixHash,
    prefixChanged: reasons.length > 0,
    prefixChangeReasons: reasons,
    systemHash: current.systemHash,
    toolsHash: current.toolsHash,
    messageShapeHash: current.messageShapeHash,
    messageContentHash: current.messageContentHash,
    contextRetentionMode: current.contextRetentionMode,
    retainedRunCount: current.retainedRunCount,
    retainedRunHash: current.retainedRunHash,
    messageCount: current.messageCount,
    previousMessageCount: previous?.messageCount,
    currentMessageCount: current.messageCount,
    toolSchemaTokens: current.toolSchemaTokens,
    appendOnlyFromPrevious,
    contentAppendOnlyFromPrevious,
    firstDifferentMessageIndex,
    addedMessageCount,
    addedMessageChars,
    addedMessageTokens,
    duplicateToolCallIds: current.duplicateToolCallIds,
    cacheHitTokens: stats?.cacheHitTokens,
    cacheMissTokens: stats?.cacheMissTokens
  }
}

const previousShapesBySession = new Map<string, CacheShapeSnapshot>()

export function previewCacheShapeForSession(
  sessionId: string,
  current: CacheShapeSnapshot,
  stats?: PromptCacheStats
): CacheShapeDiagnostics {
  return compareCacheShape(previousShapesBySession.get(sessionId), current, stats)
}

export function commitCacheShapeForSession(
  sessionId: string,
  current: CacheShapeSnapshot,
  stats?: PromptCacheStats
): CacheShapeDiagnostics {
  const diagnostics = compareCacheShape(previousShapesBySession.get(sessionId), current, stats)
  previousShapesBySession.set(sessionId, current)
  return diagnostics
}

export function resetCacheShapeDiagnosticsForTests(): void {
  previousShapesBySession.clear()
}
