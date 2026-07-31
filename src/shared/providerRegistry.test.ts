import { describe, expect, it } from 'vitest'
import {
  getProviderRegistration,
  PROVIDER_REGISTRATIONS,
  validateProviderRegistrations
} from './providerRegistry'
import { createProviderFromRegistration } from './providerFactory'
import { getProviderModelRuntimeConfig } from './modelCatalog'
import { getProviderRuntimeProfile, PROVIDER_RUNTIME_PROFILES } from './providerProfiles'

describe('providerRegistry', () => {
  it('registers each provider type only once', () => {
    const types = PROVIDER_REGISTRATIONS.map((item) => item.definition.type)
    expect(new Set(types).size).toBe(types.length)
    expect(types).toEqual(
      expect.arrayContaining([
        'opencode',
        'deepseek',
        'kimi',
        'ollama',
        'glm',
        'mimo',
        'step',
        'custom'
      ])
    )
  })

  it('keeps every registration structurally valid', () => {
    expect(validateProviderRegistrations()).toEqual([])
  })

  it('derives the compatibility profile map from registration runtime policies', () => {
    for (const item of PROVIDER_REGISTRATIONS) {
      const type = item.definition.type
      expect(getProviderRuntimeProfile(type)).toBe(item.runtime)
      expect(PROVIDER_RUNTIME_PROFILES[type]).toBe(item.runtime)
    }
    expect(getProviderRuntimeProfile('custom').supportedTransports).toEqual([
      'openai-chat-completions',
      'openai-responses'
    ])
    expect(getProviderRuntimeProfile('glm').compatibility.omitToolChoice).toBe(true)
  })

  it('keeps local provider account defaults separate from its definition', () => {
    const ollama = getProviderRegistration('ollama')
    expect(ollama?.definition.name).toBe('Local Ollama')
    expect(ollama?.accountDefaults).toMatchObject({
      apiUrl: 'http://localhost:11434/v1',
      authType: 'none'
    })
  })

  it('creates a legacy provider instance with explicit runtime metadata', () => {
    const opencode = getProviderRegistration('opencode')
    expect(opencode).toBeDefined()

    const provider = createProviderFromRegistration(opencode!, {
      id: 'account-provider',
      name: 'Work account'
    })

    expect(provider).toMatchObject({
      id: 'account-provider',
      name: 'Work account',
      type: 'opencode',
      authType: 'bearer',
      endpointType: 'openai-compatible',
      transportId: 'openai-chat-completions',
      apiFormat: 'chat-completions',
      model: 'deepseek-v4-flash-free'
    })
    expect(provider.models?.['deepseek-v4-flash-free']?.providerId).toBe('account-provider')
    expect(
      getProviderModelRuntimeConfig(provider, 'deepseek-v4-flash-free')?.compatibility
        ?.preserveToolCallReasoningContent
    ).toBe(true)
    expect(
      getProviderModelRuntimeConfig(provider, 'qwen3-coder-plus')?.compatibility
        ?.preserveToolCallReasoningContent
    ).toBe(false)
  })
})
