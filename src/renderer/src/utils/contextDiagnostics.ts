import { Message } from '../../../shared/types'
import type { ContextWindowSource } from '../../../shared/modelContext'

export interface PromptCacheDiagnostics {
  latestHitRate?: number
  averageHitRate?: number
  hitTokens: number
  missTokens: number
  promptTokens: number
  sampleCount: number
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

export function summarizePromptCacheStats(messages: Message[]): PromptCacheDiagnostics {
  let latestHitRate: number | undefined
  let hitTokens = 0
  let missTokens = 0
  let promptTokens = 0
  let sampleCount = 0
  let fallbackRateTotal = 0
  let fallbackRateCount = 0

  for (const message of messages) {
    const stats = message.role === 'assistant' ? message.cacheStats : undefined
    if (!stats || stats.hasCacheStats === false || !Number.isFinite(stats.hitRate)) continue

    latestHitRate = stats.hitRate
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
    sampleCount
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

    const hasPromptTokens =
      stats.promptTokens !== undefined && Number.isFinite(stats.promptTokens)
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
