import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateMessagesTokens } from './tokenEstimator'

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('counts ASCII at ~4 chars per token', () => {
    expect(estimateTokens('aaaa')).toBe(1)
    expect(estimateTokens('a'.repeat(40))).toBe(10)
  })

  it('counts CJK at ~1.5 chars per token (denser than ASCII)', () => {
    // 2 CJK chars -> ceil(2 / 1.5) = 2
    expect(estimateTokens('你好')).toBe(2)
    expect(estimateTokens('你'.repeat(3))).toBe(2)
  })
})

describe('estimateMessagesTokens', () => {
  it('sums content tokens plus per-message overhead', () => {
    const tokens = estimateMessagesTokens([{ role: 'user', content: 'aaaa' }])
    // estimateTokens('aaaa') = 1, + 4 overhead
    expect(tokens).toBe(5)
  })

  it('includes tool_calls but excludes reasoning_content from the prompt estimate', () => {
    const withTools = estimateMessagesTokens([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'aaaa',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'fetch_url', arguments: '{}' } }
        ]
      }
    ])
    const withReasoningOnly = estimateMessagesTokens([
      { role: 'assistant', content: '', reasoning_content: 'aaaa' }
    ])
    const bare = estimateMessagesTokens([{ role: 'assistant', content: '' }])
    expect(withTools).toBeGreaterThan(bare)
    expect(withReasoningOnly).toBe(bare)
  })

  it('handles array (multimodal) content by counting only text parts', () => {
    const tokens = estimateMessagesTokens([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'aaaa' },
          { type: 'image_url', image_url: { url: 'data:...' } }
        ]
      }
    ])
    expect(tokens).toBe(5)
  })
})
