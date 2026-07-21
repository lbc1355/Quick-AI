import { describe, expect, it } from 'vitest'
import {
  createProviderFromRegistration,
  getProviderRegistration,
  PROVIDER_REGISTRATIONS
} from './providerRegistry'

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
  })
})
