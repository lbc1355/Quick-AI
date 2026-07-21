import { describe, expect, it } from 'vitest'
import type { ApiProvider } from './types'
import {
  getProviderAccount,
  getProviderConnectionApiKey,
  getProviderDefinition,
  hasLegacyConnectionParity,
  composeProviderConfigurations,
  resolveProviderConnection,
  resolveProviderSelection,
  splitProviderConfigurations
} from './providerConfig'

const provider = (overrides: Partial<ApiProvider> = {}): ApiProvider => ({
  id: 'provider-glm',
  name: 'GLM',
  type: 'glm',
  apiKey: 'legacy-key',
  apiKeys: [
    { id: 'key-1', name: 'First', value: 'secret-1' },
    { id: 'key-2', name: 'Second', value: 'secret-2' }
  ],
  activeApiKeyId: 'key-2',
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.7',
  modelsList: ['glm-4.7'],
  headers: { 'X-Client': 'quick-ai' },
  ...overrides
})

describe('provider config boundaries', () => {
  it('keeps credentials out of provider definitions', () => {
    const definition = getProviderDefinition(provider())

    expect(definition.id).toBe('provider-glm')
    expect(definition.models['glm-4.7']).toBeDefined()
    expect(JSON.stringify(definition)).not.toContain('secret-2')
    expect(JSON.stringify(definition)).not.toContain('apiKey')
  })

  it('resolves the selected account key and custom headers', () => {
    const account = getProviderAccount(provider())
    const connection = resolveProviderConnection(account)

    expect(connection).toEqual({
      accountId: 'provider-glm',
      providerId: 'provider-glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      auth: { type: 'bearer', token: 'secret-2' },
      headers: { 'X-Client': 'quick-ai' }
    })
    expect(getProviderConnectionApiKey(connection)).toBe('secret-2')
    expect(hasLegacyConnectionParity(provider())).toBe(true)
  })

  it('round-trips the compatibility view through split persistence records', () => {
    const original = provider({
      authType: 'header',
      authHeader: 'X-API-Key',
      modelContextWindows: { 'glm-4.7': 96000 }
    })
    const split = splitProviderConfigurations([original])

    expect(split.definitions[0].defaultModelId).toBe('glm-4.7')
    expect(JSON.stringify(split.definitions)).not.toContain('secret-2')
    expect(JSON.stringify(split.accounts)).toContain('secret-2')

    const [restored] = composeProviderConfigurations(split.definitions, split.accounts)
    expect(restored).toMatchObject({
      id: 'provider-glm',
      model: 'glm-4.7',
      apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
      authType: 'header',
      authHeader: 'X-API-Key',
      activeApiKeyId: 'key-2'
    })
    expect(restored.apiKey).toBe('secret-2')
    expect(restored.modelContextWindows?.['glm-4.7']).toBe(96000)
  })

  it('supports header-based authentication without changing transports', () => {
    const account = getProviderAccount(
      provider({ authType: 'header', authHeader: 'api-key', activeApiKeyId: 'key-1' })
    )

    expect(resolveProviderConnection(account).auth).toEqual({
      type: 'header',
      name: 'api-key',
      value: 'secret-1'
    })
  })

  it('resolves definition, account, connection, and model in one selection', () => {
    const selection = resolveProviderSelection(provider(), 'glm-4.7')

    expect(selection?.definition.type).toBe('glm')
    expect(selection?.account.activeApiKeyId).toBe('key-2')
    expect(selection?.model.transportId).toBe('openai-chat-completions')
    expect(selection?.model.compatibility?.omitToolChoice).toBe(true)
  })
})
