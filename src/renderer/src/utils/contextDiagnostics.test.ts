import { describe, expect, it } from 'vitest'
import {
  buildContextCompositionSegments,
  buildContextUsageBreakdown,
  formatUsagePercent,
  getContextUsagePercent,
  summarizeConversationTokenUsage,
  summarizePromptCacheStats
} from './contextDiagnostics'
import { Message } from '../../../shared/types'

const baseDiagnostics = {
  cache: {
    latestHitRate: 75,
    averageHitRate: 80,
    hitTokens: 800,
    missTokens: 200,
    promptTokens: 1000,
    sampleCount: 2
  },
  tokenUsage: {
    promptTokens: 1500,
    completionTokens: 400,
    totalTokens: 1900,
    reasoningTokens: 120,
    sampleCount: 2,
    hasApiUsage: true
  },
  messageCount: 6,
  resourceCount: 2,
  hasSystemPrompt: true,
  modelName: 'test-model-10k',
  projectLabel: 'Quick Ai',
  customPermissionCount: 1,
  skillCount: 3,
  contextWindowTokens: 10_000,
  conversationBaseTokens: 2_000,
  steeringTokens: 500,
  mcpToolTokens: 300,
  compositionSegments: []
}

describe('contextDiagnostics', () => {
  it('summarizes latest and weighted average cache hit rates', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'hello' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'hi',
        cacheStats: {
          hasCacheStats: true,
          promptTokens: 100,
          cacheHitTokens: 70,
          cacheMissTokens: 30,
          hitRate: 70
        }
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'again',
        cacheStats: {
          hasCacheStats: true,
          promptTokens: 300,
          cacheHitTokens: 270,
          cacheMissTokens: 30,
          hitRate: 90
        }
      }
    ]

    expect(summarizePromptCacheStats(messages)).toMatchObject({
      latestHitRate: 90,
      averageHitRate: 85,
      hitTokens: 340,
      missTokens: 60,
      promptTokens: 400,
      sampleCount: 2
    })
  })

  it('summarizes API input and output token usage without treating it as cache data', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'hello' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'hi',
        cacheStats: {
          hasCacheStats: false,
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          reasoningTokens: 8,
          cacheHitTokens: 0,
          hitRate: 0
        }
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'again',
        cacheStats: {
          hasCacheStats: true,
          promptTokens: 200,
          completionTokens: 40,
          cacheHitTokens: 150,
          cacheMissTokens: 50,
          hitRate: 75
        }
      }
    ]

    expect(summarizeConversationTokenUsage(messages)).toMatchObject({
      promptTokens: 320,
      completionTokens: 70,
      totalTokens: 390,
      reasoningTokens: 8,
      sampleCount: 2,
      hasApiUsage: true
    })

    expect(summarizePromptCacheStats(messages)).toMatchObject({
      latestHitRate: 75,
      averageHitRate: 75,
      hitTokens: 150,
      missTokens: 50,
      sampleCount: 1
    })
  })

  it('builds role composition segments from messages and tool events', () => {
    const segments = buildContextCompositionSegments({
      systemPrompt: 'system prompt',
      projectLabel: 'Quick Ai',
      resources: [],
      messages: [
        { id: 'u1', role: 'user', content: 'read the file' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'done',
          agentEvents: [
            {
              type: 'tool_call',
              callId: 'call-1',
              toolName: 'file_read',
              args: { path: 'README.md' }
            },
            {
              type: 'tool_result',
              callId: 'call-1',
              result: { title: 'README.md', details: 'file contents' }
            }
          ]
        }
      ]
    })

    expect(segments.map((segment) => segment.role)).toEqual([
      'system',
      'user',
      'tool_call',
      'tool',
      'assistant'
    ])
    expect(segments.find((segment) => segment.role === 'tool_call')?.textLength).toBeGreaterThan(0)
    expect(segments.find((segment) => segment.role === 'tool')?.preview).toContain('README.md')
    expect(segments.find((segment) => segment.role === 'system')?.groupKind).toBe('system')
    expect(segments.find((segment) => segment.role === 'user')?.groupKind).toBe('user')

    const agentSegments = segments.filter((segment) => segment.groupKind === 'agent')
    expect(agentSegments.map((segment) => segment.role)).toEqual(['tool_call', 'tool', 'assistant'])
    expect(new Set(agentSegments.map((segment) => segment.groupId)).size).toBe(1)
  })
  it('builds context usage percentages for the circular meter', () => {
    const usage = buildContextUsageBreakdown({
      draftTokens: 700,
      diagnostics: baseDiagnostics
    })

    expect(usage).toMatchObject({
      conversationTokens: 2700,
      mcpToolTokens: 300,
      steeringTokens: 500,
      totalTokens: 3500,
      conversationPercent: 27,
      mcpToolPercent: 3,
      steeringPercent: 5,
      totalPercent: 35
    })
  })

  it('clamps and formats percentages', () => {
    expect(getContextUsagePercent(12_000, 10_000)).toBe(100)
    expect(getContextUsagePercent(333, 10_000)).toBe(3.3)
    expect(formatUsagePercent(3)).toBe('3%')
    expect(formatUsagePercent(3.3)).toBe('3.3%')
  })
})
