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
    expect(getContextWindowSize('totally-unknown')).toBe(128000)
    expect(getContextWindowSize('')).toBe(128000)
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

  it('leaves a read_tool_output pointer when truncating a large tool message', () => {
    const big = 'z'.repeat(5000)
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: 'a',
        tool_calls: [
          { id: 'big-call', type: 'function', function: { name: 'file_read', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'big-call', name: 'file_read', content: big },
      // Protected tail so the tool message is truncated (Phase 1), not dropped (Phase 2).
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'user', content: 'q3' },
      { role: 'user', content: 'q4' }
    ]

    const result = trimMessagesToFit(messages, { maxTokens: 700, reserveForResponse: 1 })
    const toolMsg = result.find((m) => m.role === 'tool' && m.tool_call_id === 'big-call')

    expect(toolMsg).toBeDefined()
    expect(typeof toolMsg!.content).toBe('string')
    const content = toolMsg!.content as string
    expect(content.length).toBeLessThan(big.length)
    expect(content).toContain('read_tool_output(output_id="big-call")')
  })

  it('omits the pointer for tool messages below the spillover threshold', () => {
    const medium = 'm'.repeat(1800) // > 500 (truncatable) but < 2000 (spillover threshold)
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: 'a',
        tool_calls: [
          { id: 'small-call', type: 'function', function: { name: 'web_search', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'small-call', name: 'web_search', content: medium },
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'user', content: 'q3' },
      { role: 'user', content: 'q4' }
    ]

    const result = trimMessagesToFit(messages, { maxTokens: 350, reserveForResponse: 1 })
    const toolMsg = result.find((m) => m.role === 'tool' && m.tool_call_id === 'small-call')
    const content = toolMsg!.content as string
    expect(content).toContain('truncated')
    expect(content).not.toContain('read_tool_output')
  })
})
