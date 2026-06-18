import { Message } from '../../../shared/types'

export interface PromptCacheDiagnostics {
  latestHitRate?: number
  averageHitRate?: number
  hitTokens: number
  missTokens: number
  promptTokens: number
  sampleCount: number
}

export interface ContextDiagnosticsSnapshot {
  cache: PromptCacheDiagnostics
  messageCount: number
  resourceCount: number
  hasSystemPrompt: boolean
  modelName?: string
  projectLabel?: string
  customPermissionCount: number
  skillCount: number
  contextWindowTokens: number
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
    if (!stats || !Number.isFinite(stats.hitRate)) continue

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

export function buildContextDiagnosticsTitle({
  draftTokens,
  diagnostics
}: {
  draftTokens: number
  diagnostics: ContextDiagnosticsSnapshot
}): string {
  const usage = buildContextUsageBreakdown({ draftTokens, diagnostics })
  const cache = diagnostics.cache
  const latestRate = formatCacheRate(cache.latestHitRate) || '暂无'
  const averageRate = formatCacheRate(cache.averageHitRate) || '暂无'
  const cacheTokens =
    cache.hitTokens + cache.missTokens > 0
      ? `命中 ${cache.hitTokens.toLocaleString()} / 未命中 ${cache.missTokens.toLocaleString()} tokens`
      : '当前 provider 未返回可聚合的 hit/miss tokens'

  const prefixFactors = [
    diagnostics.hasSystemPrompt ? '系统提示已启用' : '无自定义系统提示',
    diagnostics.projectLabel ? `项目上下文：${diagnostics.projectLabel}` : '自由对话，无项目上下文',
    diagnostics.resourceCount > 0
      ? `资源摘要：${diagnostics.resourceCount} 个，资源更新可能改变前缀`
      : '无资源摘要',
    diagnostics.customPermissionCount > 0
      ? `工具权限策略：${diagnostics.customPermissionCount} 项非默认配置`
      : '工具权限策略为默认形态',
    diagnostics.skillCount > 0
      ? `技能目录：${diagnostics.skillCount} 个技能，技能增删改会改变 agent 前缀`
      : '技能目录为空'
  ]

  return [
    `Model: ${diagnostics.modelName || 'Current model'}`,
    `上下文估算：${usage.totalTokens.toLocaleString()} / ${usage.contextWindowTokens.toLocaleString()} tokens (${formatUsagePercent(usage.totalPercent)})`,
    `Conversation：${usage.conversationTokens.toLocaleString()} tokens (${formatUsagePercent(usage.conversationPercent)})`,
    `MCP/tools：${usage.mcpToolTokens.toLocaleString()} tokens (${formatUsagePercent(usage.mcpToolPercent)})`,
    `Steering files：${usage.steeringTokens.toLocaleString()} tokens (${formatUsagePercent(usage.steeringPercent)})`,
    `当前输入/附件：${draftTokens.toLocaleString()} tokens`,
    `历史消息：${diagnostics.messageCount} 条`,
    '',
    `缓存命中：本轮 ${latestRate}，会话平均 ${averageRate}`,
    `缓存样本：${cache.sampleCount} 次`,
    cacheTokens,
    '',
    '可能影响 prefix/cache 的因素：',
    ...prefixFactors.map((factor) => `- ${factor}`)
  ].join('\n')
}
