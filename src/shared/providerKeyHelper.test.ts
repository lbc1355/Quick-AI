import { describe, it, expect } from 'vitest'
import {
  normalizeProviderApiKeys,
  getActiveProviderApiKey,
  syncProviderLegacyApiKey
} from './providerKeyHelper'
import { ApiProvider } from './types'

describe('providerKeyHelper', () => {
  it('should normalize old provider data with apiKey into apiKeys', () => {
    const rawProvider: ApiProvider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-123456',
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    }

    const normalized = normalizeProviderApiKeys(rawProvider)
    expect(normalized.apiKeys).toBeDefined()
    expect(normalized.apiKeys?.length).toBe(1)
    expect(normalized.apiKeys?.[0].id).toBe('default')
    expect(normalized.apiKeys?.[0].name).toBe('默认 Key')
    expect(normalized.apiKeys?.[0].value).toBe('sk-123456')
    expect(normalized.activeApiKeyId).toBe('default')
  })

  it('should not overwrite existing apiKeys if they exist', () => {
    const provider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-legacy',
      apiKeys: [
        { id: 'key-1', name: 'Key 1', value: 'val-1' },
        { id: 'key-2', name: 'Key 2', value: 'val-2' }
      ],
      activeApiKeyId: 'key-2',
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    } as ApiProvider

    const normalized = normalizeProviderApiKeys(provider)
    expect(normalized.apiKeys?.length).toBe(2)
    expect(normalized.activeApiKeyId).toBe('key-2')
  })

  it('should select first key if activeApiKeyId is missing but apiKeys exists', () => {
    const provider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-legacy',
      apiKeys: [
        { id: 'key-1', name: 'Key 1', value: 'val-1' },
        { id: 'key-2', name: 'Key 2', value: 'val-2' }
      ],
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    } as ApiProvider

    const normalized = normalizeProviderApiKeys(provider)
    expect(normalized.activeApiKeyId).toBe('key-1')
  })

  it('should retrieve active key value via getActiveProviderApiKey', () => {
    const provider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-legacy',
      apiKeys: [
        { id: 'key-1', name: 'Key 1', value: 'val-1' },
        { id: 'key-2', name: 'Key 2', value: 'val-2' }
      ],
      activeApiKeyId: 'key-2',
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    } as ApiProvider

    const activeKey = getActiveProviderApiKey(provider)
    expect(activeKey).toBe('val-2')
  })

  it('should synchronize active key value to legacy apiKey using syncProviderLegacyApiKey', () => {
    const provider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-legacy',
      apiKeys: [
        { id: 'key-1', name: 'Key 1', value: 'val-1' },
        { id: 'key-2', name: 'Key 2', value: 'val-2' }
      ],
      activeApiKeyId: 'key-2',
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    } as ApiProvider

    const synced = syncProviderLegacyApiKey(provider)
    expect(synced.apiKey).toBe('val-2')
  })

  it('should strictly return empty string if activeApiKeyId is not found in apiKeys', () => {
    const provider = {
      id: 'test-prov',
      name: 'Test',
      type: 'custom',
      apiKey: 'sk-legacy',
      apiKeys: [{ id: 'key-1', name: 'Key 1', value: 'val-1' }],
      activeApiKeyId: 'non-existent-key-id',
      apiUrl: 'https://test.api',
      model: 'test-model',
      modelsList: []
    } as ApiProvider

    const activeKey = getActiveProviderApiKey(provider)
    expect(activeKey).toBe('')
  })
})
