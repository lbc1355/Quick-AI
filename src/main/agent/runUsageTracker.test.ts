import { describe, expect, it } from 'vitest'

import { createRunUsageTracker } from './runUsageTracker'

describe('createRunUsageTracker', () => {
  it('reports zero token speed before any model response is recorded', () => {
    const tracker = createRunUsageTracker()

    expect(tracker.getTokenSpeed()).toBe(0)
    expect(tracker.getAggregatedCacheStats()).toBeUndefined()
  })

  it('estimates generated token speed from assistant content and reasoning text', () => {
    const tracker = createRunUsageTracker()

    tracker.recordModelResponse(
      {
        role: 'assistant',
        content: 'a'.repeat(8),
        reasoning_content: 'b'.repeat(8)
      },
      1000
    )

    expect(tracker.getTokenSpeed()).toBe(4)
  })

  it('returns usage totals even when the provider has no cache stats', () => {
    const tracker = createRunUsageTracker()

    tracker.recordModelResponse(
      { role: 'assistant', content: 'Done.' },
      500,
      {
        hasCacheStats: false,
        promptTokens: 100,
        completionTokens: 20,
        reasoningTokens: 5,
        totalTokens: 125,
        cacheHitTokens: 0,
        hitRate: 0
      }
    )

    expect(tracker.getAggregatedCacheStats()).toEqual({
      hasCacheStats: false,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 125,
      reasoningTokens: 5,
      cacheHitTokens: 0,
      cacheMissTokens: undefined,
      hitRate: 0
    })
  })

  it('infers cache miss tokens from prompt tokens when the provider omits misses', () => {
    const tracker = createRunUsageTracker()

    tracker.recordModelResponse(
      { role: 'assistant', content: 'Done.' },
      500,
      {
        promptTokens: 100,
        completionTokens: 10,
        cacheHitTokens: 70,
        hitRate: 70
      }
    )

    expect(tracker.getAggregatedCacheStats()).toEqual({
      hasCacheStats: true,
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      reasoningTokens: undefined,
      cacheHitTokens: 70,
      cacheMissTokens: 30,
      hitRate: 70
    })
  })

  it('aggregates usage and cache stats across multiple model responses', () => {
    const tracker = createRunUsageTracker()

    tracker.recordModelResponse(
      { role: 'assistant', content: 'First.' },
      100,
      {
        promptTokens: 100,
        completionTokens: 10,
        cacheHitTokens: 50,
        cacheMissTokens: 50,
        hitRate: 50
      }
    )
    tracker.recordModelResponse(
      { role: 'assistant', content: 'Second.' },
      100,
      {
        promptTokens: 50,
        completionTokens: 5,
        cacheHitTokens: 25,
        cacheMissTokens: 25,
        hitRate: 50
      }
    )

    expect(tracker.getAggregatedCacheStats()).toEqual({
      hasCacheStats: true,
      promptTokens: 150,
      completionTokens: 15,
      totalTokens: 165,
      reasoningTokens: undefined,
      cacheHitTokens: 75,
      cacheMissTokens: 75,
      hitRate: 50
    })
  })
})
