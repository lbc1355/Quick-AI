import { describe, expect, it } from 'vitest'
import { buildModelPromptProfile, resolveModelPromptProfile } from './modelPromptProfile'

describe('modelPromptProfile', () => {
  it('uses an explicit runtime profile before model-name inference', () => {
    expect(
      resolveModelPromptProfile({
        modelId: 'custom',
        apiModel: 'claude-sonnet',
        promptProfile: 'gpt'
      })
    ).toBe('gpt')
  })

  it('infers common model families when no explicit profile is supplied', () => {
    expect(resolveModelPromptProfile({ modelId: 'a', apiModel: 'claude-sonnet' })).toBe('claude')
    expect(resolveModelPromptProfile({ modelId: 'b', apiModel: 'gemini-2.5-pro' })).toBe('gemini')
    expect(resolveModelPromptProfile({ modelId: 'c', apiModel: 'gpt-5-codex' })).toBe('gpt')
    expect(resolveModelPromptProfile({ modelId: 'd', apiModel: 'deepseek-reasoner' })).toBe(
      'reasoning'
    )
  })

  it('keeps the default profile empty to avoid adding irrelevant prompt text', () => {
    expect(buildModelPromptProfile({ modelId: 'qwen', apiModel: 'qwen-coder' })).toBe('')
  })
})
