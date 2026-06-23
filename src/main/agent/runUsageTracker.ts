import { ChatCompletionMessage, PromptCacheStats } from '../../shared/types'
import { estimateTokens } from './tokenEstimator'

export interface RunUsageTracker {
  recordModelResponse(
    message: ChatCompletionMessage,
    elapsedMs: number,
    cacheStats?: PromptCacheStats
  ): void
  getTokenSpeed(): number
  getAggregatedCacheStats(): PromptCacheStats | undefined
}

export function createRunUsageTracker(): RunUsageTracker {
  let totalGeneratedTokens = 0
  let totalGenerationTimeMs = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let totalCachePromptTokens = 0
  let totalCompletionTokens = 0
  let totalReasoningTokens = 0
  let totalUsageTokens = 0
  let hasCacheStats = false
  let hasUsageStats = false
  let latestCacheDiagnostics: PromptCacheStats['cacheDiagnostics'] | undefined

  const addPromptCacheStats = (stats: PromptCacheStats | undefined): void => {
    if (!stats) return

    if (stats.cacheDiagnostics) {
      latestCacheDiagnostics = stats.cacheDiagnostics
    }

    if (stats.promptTokens !== undefined) {
      hasUsageStats = true
      totalCachePromptTokens += stats.promptTokens
    }
    if (stats.completionTokens !== undefined) {
      hasUsageStats = true
      totalCompletionTokens += stats.completionTokens
    }
    if (stats.reasoningTokens !== undefined) {
      hasUsageStats = true
      totalReasoningTokens += stats.reasoningTokens
    }
    if (stats.totalTokens !== undefined) {
      hasUsageStats = true
      totalUsageTokens += stats.totalTokens
    }

    if (stats.hasCacheStats === false) return

    hasCacheStats = true
    totalCacheHitTokens += stats.cacheHitTokens
    if (stats.cacheMissTokens !== undefined) {
      totalCacheMissTokens += stats.cacheMissTokens
    } else if (stats.promptTokens !== undefined) {
      totalCacheMissTokens += Math.max(0, stats.promptTokens - stats.cacheHitTokens)
    }
  }

  return {
    recordModelResponse(message, elapsedMs, cacheStats): void {
      const reasoningText = message.reasoning_content || ''
      const contentText = typeof message.content === 'string' ? message.content : ''
      totalGeneratedTokens += estimateTokens(reasoningText) + estimateTokens(contentText)
      totalGenerationTimeMs += elapsedMs
      addPromptCacheStats(cacheStats)
    },

    getTokenSpeed(): number {
      const totalGenerationSec = totalGenerationTimeMs / 1000
      return totalGenerationSec > 0
        ? Number((totalGeneratedTokens / totalGenerationSec).toFixed(1))
        : 0
    },

    getAggregatedCacheStats(): PromptCacheStats | undefined {
      if (!hasCacheStats && !hasUsageStats) return undefined
      const denominator =
        totalCacheHitTokens + totalCacheMissTokens > 0
          ? totalCacheHitTokens + totalCacheMissTokens
          : totalCachePromptTokens
      const totalTokens =
        totalUsageTokens > 0
          ? totalUsageTokens
          : totalCachePromptTokens + totalCompletionTokens > 0
            ? totalCachePromptTokens + totalCompletionTokens
            : undefined
      return {
        hasCacheStats,
        promptTokens: totalCachePromptTokens > 0 ? totalCachePromptTokens : undefined,
        completionTokens: totalCompletionTokens > 0 ? totalCompletionTokens : undefined,
        totalTokens,
        reasoningTokens: totalReasoningTokens > 0 ? totalReasoningTokens : undefined,
        cacheHitTokens: totalCacheHitTokens,
        cacheMissTokens: hasCacheStats ? totalCacheMissTokens : undefined,
        hitRate:
          hasCacheStats && denominator && denominator > 0
            ? Number(((totalCacheHitTokens / denominator) * 100).toFixed(1))
            : 0,
        ...(latestCacheDiagnostics ? { cacheDiagnostics: latestCacheDiagnostics } : {})
      }
    }
  }
}
