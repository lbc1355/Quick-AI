import type { CacheShapeDiagnostics, Message, SessionResource } from '../../../shared/types'
import type { ContextWindowSource } from '../../../shared/modelContext'
import { estimateTokens } from '../../../shared/tokenEstimator'
import { getMessagesForCurrentContext } from './contextMessages'

export type ContextCompositionRole = 'system' | 'tool_call' | 'tool' | 'user' | 'assistant'
export type ContextCompositionGroupKind = 'system' | 'user' | 'agent'

export interface ContextCompositionSegment {
  id: string
  role: ContextCompositionRole
  label: string
  textLength: number
  tokenEstimate: number
  preview?: string
  groupId?: string
  groupKind?: ContextCompositionGroupKind
  groupLabel?: string
}

export interface PromptCacheDiagnostics {
  latestHitRate?: number
  averageHitRate?: number
  hitTokens: number
  missTokens: number
  promptTokens: number
  sampleCount: number
  latestDiagnostics?: CacheShapeDiagnostics
}

export interface ConversationTokenDiagnostics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens: number
  sampleCount: number
  hasApiUsage: boolean
}

export interface ContextDiagnosticsSnapshot {
  cache: PromptCacheDiagnostics
  tokenUsage: ConversationTokenDiagnostics
  messageCount: number
  resourceCount: number
  hasSystemPrompt: boolean
  modelName?: string
  projectLabel?: string
  customPermissionCount: number
  skillCount: number
  contextWindowTokens: number
  contextWindowSource?: ContextWindowSource
  conversationBaseTokens: number
  steeringTokens: number
  mcpToolTokens: number
  compositionSegments: ContextCompositionSegment[]
}

export interface ContextUsageBreakdown {
  conversationTokens: number
  mcpToolTokens: number
  steeringTokens: number
  totalTokens: number
  contextWindowTokens: number
  conversationPercent: number
  mcpToolPercent: number
  steeringPercent: number
  totalPercent: number
}

const CONTEXT_COMPOSITION_PREVIEW_LIMIT = 120

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const stringifyForLength = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const previewText = (value: string): string | undefined => {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return undefined
  return normalized.length > CONTEXT_COMPOSITION_PREVIEW_LIMIT
    ? normalized.slice(0, CONTEXT_COMPOSITION_PREVIEW_LIMIT - 1) + '\u2026'
    : normalized
}

const pushSegment = (
  segments: ContextCompositionSegment[],
  segment: Omit<ContextCompositionSegment, 'textLength' | 'tokenEstimate'> & { text: string }
): void => {
  const text = segment.text || ''
  const textLength = text.length
  if (textLength <= 0) return

  segments.push({
    id: segment.id,
    role: segment.role,
    label: segment.label,
    textLength,
    tokenEstimate: estimateTokens(text),
    preview: segment.preview ?? previewText(text),
    groupId: segment.groupId,
    groupKind: segment.groupKind,
    groupLabel: segment.groupLabel
  })
}

const buildResourceText = (resources: SessionResource[] | undefined): string => {
  if (!resources?.length) return ''

  return resources
    .map((resource) => {
      const chunks = (resource.chunks || [])
        .map((chunk) => chunk.summary || chunk.text || '')
        .filter(Boolean)
        .join('\n')
      return [resource.title, resource.source, resource.summary, chunks].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

const buildUserMessageText = (message: Message): string => {
  const files = (message.files || [])
    .map((file) => [file.name, file.type, file.content].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
  return [message.content, files].filter(Boolean).join('\n\n')
}

const buildAssistantMessageText = (message: Message): string =>
  [message.reasoning_content, message.content].filter(Boolean).join('\n\n')

const buildToolResultText = (result: unknown): string => {
  if (!result || typeof result !== 'object') return stringifyForLength(result)

  const resultRecord = result as {
    title?: string
    url?: string
    summary?: string
    details?: string
    items?: Array<{ title?: string; url?: string; snippet?: string; source?: string }>
  }
  const items = (resultRecord.items || [])
    .map((item) => [item.title, item.url, item.source, item.snippet].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')

  const structured = [
    resultRecord.title,
    resultRecord.url,
    resultRecord.summary,
    resultRecord.details,
    items
  ]
    .filter(Boolean)
    .join('\n\n')

  return structured || stringifyForLength(result)
}

export function buildContextCompositionSegments({
  messages,
  systemPrompt,
  projectLabel,
  resources
}: {
  messages: Message[]
  systemPrompt: string
  projectLabel?: string
  resources?: SessionResource[]
}): ContextCompositionSegment[] {
  const segments: ContextCompositionSegment[] = []
  const steeringText = [systemPrompt, projectLabel, buildResourceText(resources)]
    .filter(Boolean)
    .join('\n\n')

  pushSegment(segments, {
    id: 'system-steering',
    role: 'system',
    label: 'system',
    text: steeringText,
    groupId: 'system-steering',
    groupKind: 'system',
    groupLabel: 'System'
  })

  let agentTurn = 0

  for (const message of getMessagesForCurrentContext(messages)) {
    if (message.role === 'user') {
      pushSegment(segments, {
        id: `user-${message.id}`,
        role: 'user',
        label: 'user',
        text: buildUserMessageText(message),
        groupId: `user-${message.id}`,
        groupKind: 'user',
        groupLabel: 'User'
      })
      continue
    }

    agentTurn += 1
    const agentGroupId = `agent-${message.agentRunId || message.agentRunIds?.[0] || message.id}`
    const agentGroupLabel = `Agent turn ${agentTurn}`
    const streamedToolOutput = new Map<string, string>()
    const completedToolOutputs = new Set<string>()

    for (const [eventIndex, event] of (message.agentEvents || []).entries()) {
      if (event.type === 'tool_call') {
        const argsText = stringifyForLength(event.args)
        pushSegment(segments, {
          id: `tool-call-${event.callId || message.id}-${eventIndex}`,
          role: 'tool_call',
          label: event.toolName || 'tool call',
          text: [event.toolName, event.purpose, argsText].filter(Boolean).join('\n'),
          preview: previewText(argsText || event.toolName),
          groupId: agentGroupId,
          groupKind: 'agent',
          groupLabel: agentGroupLabel
        })
      } else if (event.type === 'tool_result') {
        completedToolOutputs.add(event.callId)
        pushSegment(segments, {
          id: `tool-result-${event.callId || message.id}-${eventIndex}`,
          role: 'tool',
          label: event.result.title || event.callId || 'tool',
          text: buildToolResultText(event.result),
          groupId: agentGroupId,
          groupKind: 'agent',
          groupLabel: agentGroupLabel
        })
      } else if (event.type === 'tool_error') {
        completedToolOutputs.add(event.callId)
        pushSegment(segments, {
          id: `tool-error-${event.callId || message.id}-${eventIndex}`,
          role: 'tool',
          label: event.callId || 'tool error',
          text: event.error,
          groupId: agentGroupId,
          groupKind: 'agent',
          groupLabel: agentGroupLabel
        })
      } else if (event.type === 'tool_output_delta') {
        const current = streamedToolOutput.get(event.callId) || ''
        streamedToolOutput.set(
          event.callId,
          event.replace ? event.content : current + event.content
        )
      }
    }

    for (const [callId, output] of streamedToolOutput.entries()) {
      if (completedToolOutputs.has(callId)) continue
      pushSegment(segments, {
        id: `tool-stream-${callId}`,
        role: 'tool',
        label: callId || 'tool stream',
        text: output,
        groupId: agentGroupId,
        groupKind: 'agent',
        groupLabel: agentGroupLabel
      })
    }

    pushSegment(segments, {
      id: `assistant-${message.id}`,
      role: 'assistant',
      label: 'assistant',
      text: buildAssistantMessageText(message),
      groupId: agentGroupId,
      groupKind: 'agent',
      groupLabel: agentGroupLabel
    })
  }

  return segments
}
export function summarizePromptCacheStats(messages: Message[]): PromptCacheDiagnostics {
  let latestHitRate: number | undefined
  let hitTokens = 0
  let missTokens = 0
  let promptTokens = 0
  let sampleCount = 0
  let fallbackRateTotal = 0
  let fallbackRateCount = 0
  let latestDiagnostics: CacheShapeDiagnostics | undefined

  for (const message of messages) {
    const stats = message.role === 'assistant' ? message.cacheStats : undefined
    if (!stats || stats.hasCacheStats === false || !Number.isFinite(stats.hitRate)) continue

    latestHitRate = stats.hitRate
    if (stats.cacheDiagnostics) latestDiagnostics = stats.cacheDiagnostics
    sampleCount += 1
    fallbackRateTotal += stats.hitRate
    fallbackRateCount += 1

    const hit = Number.isFinite(stats.cacheHitTokens) ? stats.cacheHitTokens : 0
    const miss =
      stats.cacheMissTokens !== undefined && Number.isFinite(stats.cacheMissTokens)
        ? stats.cacheMissTokens
        : stats.promptTokens !== undefined && Number.isFinite(stats.promptTokens)
          ? Math.max(0, stats.promptTokens - hit)
          : undefined

    if (miss === undefined) continue

    hitTokens += hit
    missTokens += miss
    promptTokens += stats.promptTokens ?? hit + miss
  }

  const weightedTotal = hitTokens + missTokens
  const averageHitRate =
    weightedTotal > 0
      ? Number(((hitTokens / weightedTotal) * 100).toFixed(1))
      : fallbackRateCount > 0
        ? Number((fallbackRateTotal / fallbackRateCount).toFixed(1))
        : undefined

  return {
    latestHitRate,
    averageHitRate,
    hitTokens,
    missTokens,
    promptTokens,
    sampleCount,
    latestDiagnostics
  }
}

export function summarizeConversationTokenUsage(messages: Message[]): ConversationTokenDiagnostics {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let reasoningTokens = 0
  let sampleCount = 0

  for (const message of messages) {
    const stats = message.role === 'assistant' ? message.cacheStats : undefined
    if (!stats) continue

    const hasPromptTokens = stats.promptTokens !== undefined && Number.isFinite(stats.promptTokens)
    const hasCompletionTokens =
      stats.completionTokens !== undefined && Number.isFinite(stats.completionTokens)
    const hasTotalTokens = stats.totalTokens !== undefined && Number.isFinite(stats.totalTokens)
    const hasReasoningTokens =
      stats.reasoningTokens !== undefined && Number.isFinite(stats.reasoningTokens)

    if (!hasPromptTokens && !hasCompletionTokens && !hasTotalTokens && !hasReasoningTokens) {
      continue
    }

    sampleCount += 1
    if (hasPromptTokens) promptTokens += stats.promptTokens!
    if (hasCompletionTokens) completionTokens += stats.completionTokens!
    if (hasReasoningTokens) reasoningTokens += stats.reasoningTokens!

    if (hasTotalTokens) {
      totalTokens += stats.totalTokens!
    } else {
      totalTokens +=
        (hasPromptTokens ? stats.promptTokens! : 0) +
        (hasCompletionTokens ? stats.completionTokens! : 0)
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    sampleCount,
    hasApiUsage: sampleCount > 0
  }
}

export function formatCacheRate(rate: number | undefined): string | null {
  return rate !== undefined && Number.isFinite(rate) ? `${rate}%` : null
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Number(value.toFixed(1))))
}

export function getContextUsagePercent(tokens: number, contextWindowTokens: number): number {
  if (!contextWindowTokens || contextWindowTokens <= 0) return 0
  return clampPercent((tokens / contextWindowTokens) * 100)
}

export function buildContextUsageBreakdown({
  draftTokens,
  diagnostics
}: {
  draftTokens: number
  diagnostics: ContextDiagnosticsSnapshot
}): ContextUsageBreakdown {
  const contextWindowTokens = diagnostics.contextWindowTokens
  const conversationTokens = Math.max(0, diagnostics.conversationBaseTokens + draftTokens)
  const mcpToolTokens = Math.max(0, diagnostics.mcpToolTokens)
  const steeringTokens = Math.max(0, diagnostics.steeringTokens)
  const totalTokens = conversationTokens + mcpToolTokens + steeringTokens

  return {
    conversationTokens,
    mcpToolTokens,
    steeringTokens,
    totalTokens,
    contextWindowTokens,
    conversationPercent: getContextUsagePercent(conversationTokens, contextWindowTokens),
    mcpToolPercent: getContextUsagePercent(mcpToolTokens, contextWindowTokens),
    steeringPercent: getContextUsagePercent(steeringTokens, contextWindowTokens),
    totalPercent: getContextUsagePercent(totalTokens, contextWindowTokens)
  }
}

export function formatUsagePercent(percent: number): string {
  return percent % 1 === 0 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`
}
