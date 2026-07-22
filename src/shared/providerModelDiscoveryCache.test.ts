import { describe, expect, it } from 'vitest'
import {
  canRefreshProviderModelsInBackground,
  completeProviderModelDiscovery,
  failProviderModelDiscovery,
  getCachedProviderModels,
  normalizeProviderModelDiscoveryCache,
  shouldRefreshProviderModels
} from './providerModelDiscoveryCache'
import type { ProviderModelDiscoveryRequest } from './types'

describe('provider model discovery cache', () => {
  it('records a successful refresh and returns defensive model copies', () => {
    const cache = completeProviderModelDiscovery(
      'https://api.example.test/v1/models',
      [{ id: 'vision-model', capabilities: ['text', 'vision'] }],
      100
    )

    const cached = getCachedProviderModels(cache, 'https://api.example.test/v1/models')
    expect(cache).toMatchObject({ checkedAt: 100, refreshedAt: 100 })
    expect(cached).toEqual([{ id: 'vision-model', capabilities: ['text', 'vision'] }])
    expect(cached).not.toBe(cache.models)
    expect(cached[0].capabilities).not.toBe(cache.models[0].capabilities)
  })

  it('preserves the last-known catalog when a refresh fails', () => {
    const previous = completeProviderModelDiscovery(
      'https://api.example.test/v1/models',
      [{ id: 'stable-model' }],
      100
    )
    const failed = failProviderModelDiscovery(
      previous,
      'https://api.example.test/v1/models',
      new Error('offline'),
      200
    )

    expect(failed).toEqual({
      sourceUrl: 'https://api.example.test/v1/models',
      models: [{ id: 'stable-model' }],
      checkedAt: 200,
      refreshedAt: 100,
      error: 'offline'
    })
    expect(getCachedProviderModels(failed, failed.sourceUrl)).toHaveLength(1)
  })

  it('does not reuse a catalog fetched from a different endpoint', () => {
    const previous = completeProviderModelDiscovery('https://old.test/models', [{ id: 'old' }], 100)
    const failed = failProviderModelDiscovery(previous, 'https://new.test/models', 'denied', 200)

    expect(failed.models).toEqual([])
    expect(failed.refreshedAt).toBeUndefined()
    expect(getCachedProviderModels(previous, 'https://new.test/models')).toEqual([])
  })

  it('refreshes stale catalogs but applies a short retry delay after errors', () => {
    const fresh = completeProviderModelDiscovery('https://api.test/models', [{ id: 'one' }], 1_000)
    const failed = failProviderModelDiscovery(fresh, fresh.sourceUrl, 'timeout', 20_000)

    expect(shouldRefreshProviderModels(fresh, fresh.sourceUrl, 2_000, 10_000)).toBe(false)
    expect(shouldRefreshProviderModels(fresh, fresh.sourceUrl, 12_000, 10_000)).toBe(true)
    expect(shouldRefreshProviderModels(failed, failed.sourceUrl, 21_000, 10_000, 5_000)).toBe(false)
    expect(shouldRefreshProviderModels(failed, failed.sourceUrl, 26_000, 10_000, 5_000)).toBe(true)
    const recentCatalogFailure = failProviderModelDiscovery(
      fresh,
      fresh.sourceUrl,
      'timeout',
      2_000
    )
    expect(
      shouldRefreshProviderModels(recentCatalogFailure, fresh.sourceUrl, 8_000, 100_000, 5_000)
    ).toBe(true)
  })

  it('only background refreshes accounts with usable connection settings', () => {
    const request = (token: string): ProviderModelDiscoveryRequest => ({
      fetchUrl: 'https://api.test/models',
      providerType: 'custom',
      providerConnection: {
        accountId: 'account',
        providerId: 'provider',
        baseUrl: 'https://api.test/v1',
        auth: { type: 'bearer', token },
        headers: {}
      }
    })

    expect(canRefreshProviderModelsInBackground(request(''))).toBe(false)
    expect(canRefreshProviderModelsInBackground(request('secret'))).toBe(true)
    expect(
      canRefreshProviderModelsInBackground({
        ...request(''),
        providerConnection: {
          ...request('').providerConnection,
          auth: { type: 'none' }
        }
      })
    ).toBe(true)
  })

  it('rejects empty legacy values and sanitizes persisted cache data', () => {
    expect(normalizeProviderModelDiscoveryCache({})).toBeUndefined()
    expect(normalizeProviderModelDiscoveryCache('invalid')).toBeUndefined()
    expect(
      normalizeProviderModelDiscoveryCache({
        sourceUrl: ' https://api.test/models ',
        models: [
          { id: ' model ', capabilities: ['vision', 'unknown'], contextWindowTokens: -1 },
          { missing: 'id' }
        ],
        checkedAt: -1,
        error: ''
      })
    ).toEqual({
      sourceUrl: 'https://api.test/models',
      models: [
        {
          id: 'model',
          capabilities: ['vision']
        }
      ],
      checkedAt: undefined,
      refreshedAt: undefined,
      error: undefined
    })
  })
})
