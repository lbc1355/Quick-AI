import { describe, expect, it } from 'vitest'
import {
  estimateBaseConversationContextTokens,
  estimateConversationContextTokens,
  estimateDraftContextTokens,
  formatContextTokenCount
} from './contextLength'

describe('contextLength', () => {
  it('counts system prompt, history, draft input, and text attachments', () => {
    const base = estimateConversationContextTokens({
      messages: [{ id: '1', role: 'user', content: 'hello' }],
      systemPrompt: 'You are concise.'
    })

    const withDraftAndAttachment = estimateConversationContextTokens({
      messages: [{ id: '1', role: 'user', content: 'hello' }],
      systemPrompt: 'You are concise.',
      input: 'please summarize',
      attachedFiles: [{ name: 'note.txt', type: 'text', content: 'important context' }]
    })

    expect(withDraftAndAttachment).toBeGreaterThan(base)
  })

  it('allows base context and draft context to be estimated independently', () => {
    const base = estimateBaseConversationContextTokens({
      messages: [{ id: '1', role: 'assistant', content: 'long history' }],
      systemPrompt: 'System prompt'
    })
    const draftInput = estimateDraftContextTokens({ input: 'typing' })
    const draftAttachment = estimateDraftContextTokens({
      attachedFiles: [{ name: 'note.txt', type: 'text', content: 'file context' }]
    })

    expect(base).toBeGreaterThan(0)
    expect(draftInput).toBeGreaterThan(0)
    expect(draftAttachment).toBeGreaterThan(0)
  })

  it('formats token counts compactly', () => {
    expect(formatContextTokenCount(999)).toBe('999')
    expect(formatContextTokenCount(1200)).toBe('1.2k')
    expect(formatContextTokenCount(12_300)).toBe('12k')
  })
})
