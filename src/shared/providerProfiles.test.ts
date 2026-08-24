import { describe, expect, it } from 'vitest'
import {
  getProviderRuntimeProfile,
  inferModelPromptProfile,
  resolveModelFeatureSupport,
  resolveModelPromptProfile
} from './providerProfiles'

describe('providerProfiles', () => {
  it('infers prompt families from API model ids', () => {
    expect(inferModelPromptProfile('gpt-5-codex')).toBe('gpt')
    expect(inferModelPromptProfile('claude-sonnet-4')).toBe('claude')
    expect(inferModelPromptProfile('gemini-2.5-pro')).toBe('gemini')
    expect(inferModelPromptProfile('deepseek-reasoner')).toBe('reasoning')
    expect(inferModelPromptProfile('qwen-coder')).toBe('default')
  })

  it('prefers model and provider prompt overrides before inference', () => {
    const model = { id: 'm', apiId: 'claude-sonnet', promptProfile: 'gemini' as const }
    expect(resolveModelPromptProfile({ type: 'custom' }, model)).toBe('gemini')
    expect(
      resolveModelPromptProfile(
        { type: 'custom', promptProfile: 'gpt' },
        { id: 'm', apiId: 'claude-sonnet' }
      )
    ).toBe('gpt')
  })

  it('merges defaults, legacy capabilities, provider overrides, and model overrides', () => {
    expect(
      resolveModelFeatureSupport(
        { type: 'ollama', features: { streamUsage: true } },
        {
          id: 'vision-only',
          apiId: 'vision-only',
          capabilities: ['text', 'vision'],
          features: { promptCaching: true }
        }
      )
    ).toEqual({
      toolCalls: false,
      parallelToolCalls: false,
      reasoning: false,
      vision: true,
      promptCaching: true,
      streamUsage: true
    })
  })

  it('keeps custom streams EOF-compatible while known DeepSeek routes require completion markers', () => {
    expect(getProviderRuntimeProfile('custom').streamPolicy).toEqual({
      completionMode: 'allow-eof',
      idleTimeoutMs: 300000
    })
    expect(getProviderRuntimeProfile('deepseek').streamPolicy.completionMode).toBe(
      'require-explicit'
    )
    expect(getProviderRuntimeProfile('opencode').streamPolicy.completionMode).toBe(
      'require-explicit'
    )
  })
})
