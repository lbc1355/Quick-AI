import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelDiscoveryRequest } from '../shared/types'

import { fetchModels } from './aiClient'

const request = (fetchUrl: string, token = ''): ProviderModelDiscoveryRequest => ({
  fetchUrl,
  providerType: 'custom' as const,
  providerConnection: {
    accountId: 'provider',
    providerId: 'provider',
    baseUrl: 'https://api.example.com/v1',
    auth: token ? { type: 'bearer' as const, token } : { type: 'none' as const },
    headers: {}
  }
})

describe('fetchModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses OpenAI-style model lists with optional context metadata', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model-a', context_length: 128000 },
          { id: 'model-b', max_context_tokens: '64000' },
          { id: 'model-c' }
        ]
      })
    } as unknown as Response)

    await expect(fetchModels(request('https://api.example.com/v1/models', 'key'))).resolves.toEqual(
      [
        { id: 'model-a', contextWindowTokens: 128000 },
        { id: 'model-b', contextWindowTokens: 64000 },
        { id: 'model-c' }
      ]
    )
  })

  it('keeps compatibility with array string responses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ['model-a', 'model-b']
    } as unknown as Response)

    await expect(fetchModels(request('https://api.example.com/v1/models'))).resolves.toEqual([
      { id: 'model-a' },
      { id: 'model-b' }
    ])
  })

  it('uses the resolved provider connection for custom auth and headers', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    } as unknown as Response)

    await fetchModels({
      fetchUrl: 'https://api.example.com/v1/models',
      providerType: 'custom',
      providerConnection: {
        accountId: 'provider',
        providerId: 'provider',
        baseUrl: 'https://api.example.com/v1',
        auth: { type: 'header', name: 'X-API-Key', value: 'custom-key' },
        headers: { 'X-Tenant': 'quick-ai' }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': 'quick-ai',
        'X-API-Key': 'custom-key'
      }
    })
  })

  it('deduplicates concurrent discovery requests for the same provider account', async () => {
    const fetchMock = vi.mocked(fetch)
    let release: ((response: Response) => void) | undefined
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const discoveryRequest = request('https://api.example.com/v1/models', 'key')

    const first = fetchModels(discoveryRequest)
    const second = fetchModels(discoveryRequest)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release?.({ ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) } as Response)
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: 'model-a' }],
      [{ id: 'model-a' }]
    ])
  })

  it('throws descriptive error when response body is not JSON', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<!doctype html><html><body>Error</body></html>'
    } as unknown as Response)

    await expect(fetchModels(request('https://api.example.com/v1/models'))).rejects.toThrow(
      'Failed to parse models response as JSON. Response body starts with: "<!doctype html><html><body>Error</body></html>"'
    )
  })
})
