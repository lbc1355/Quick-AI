import { describe, it, expect } from 'vitest'
import { getContextWindowSize, trimMessagesToFit } from './contextManager'
import { ChatCompletionMessage } from '../../shared/types'

describe('getContextWindowSize', () => {
  it('uses the explicit table for known models', () => {
    expect(getContextWindowSize('deepseek-chat')).toBe(64000)
    expect(getContextWindowSize('moonshot-v1-128k')).toBe(128000)
  })

  it('infers size from a -NNk / -NNm suffix', () => {
    expect(getContextWindowSize('some-model-32k')).toBe(32000)
    expect(getContextWindowSize('big_model_1m')).toBe(1000000)
  })

  it('falls back to the default for unknown or empty model names', () => {
    expect(getContextWindowSize('totally-unknown')).toBe(16000)
    expect(getContextWindowSize('')).toBe(16000)
  })
})

describe('trimMessagesToFit', () => {
  it('returns the original array untouched when already under budget', () => {
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' }
    ]
    const result = trimMessagesToFit(messages, { maxTokens: 64000, reserveForResponse: 2000 })
    expect(result).toBe(messages)
  })

  it('drops an assistant(tool_calls) message together with its tool responses', () => {
    const big = 'a'.repeat(4000) // ~1000 tokens of ASCII
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: big,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'fetch_url', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'c1', name: 'fetch_url', content: big },
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'user', content: 'q3' },
      { role: 'user', content: 'q4' }
    ]

    const result = trimMessagesToFit(messages, { maxTokens: 100, reserveForResponse: 0 })

    const hasAssistantC1 = result.some(
      (m) => m.role === 'assistant' && m.tool_calls?.some((t) => t.id === 'c1')
    )
    const hasToolC1 = result.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')

    // The whole unit must be removed together — never an orphaned tool message.
    expect(hasAssistantC1).toBe(false)
    expect(hasToolC1).toBe(false)
  })

  it('never leaves a tool message without its parent assistant', () => {
    const big = 'b'.repeat(4000)
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older' },
      {
        role: 'assistant',
        content: big,
        tool_calls: [
          { id: 'x1', type: 'function', function: { name: 'web_search', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'x1', name: 'web_search', content: big },
      { role: 'user', content: 't1' },
      { role: 'user', content: 't2' },
      { role: 'user', content: 't3' },
      { role: 'user', content: 't4' }
    ]

    const result = trimMessagesToFit(messages, { maxTokens: 120, reserveForResponse: 0 })

    // Invariant: every tool message has a preceding assistant carrying its tool_call_id.
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]
      if (msg.role !== 'tool') continue
      const parentExists = result
        .slice(0, i)
        .some((m) => m.role === 'assistant' && m.tool_calls?.some((t) => t.id === msg.tool_call_id))
      expect(parentExists).toBe(true)
    }
  })
})
