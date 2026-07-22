import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelDiscoveryRequest } from '../shared/types'

import { fetchModels, testProviderConnection } from './aiClient'

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
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  it('returns latency and model count for a successful connection test', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
    } as unknown as Response)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_042)

    await expect(
      testProviderConnection(request('https://api.example.com/v1/models', 'key'))
    ).resolves.toEqual({
      ok: true,
      code: 'ok',
      message: 'Connection succeeded and returned 2 models',
      endpoint: 'https://api.example.com/v1/models',
      checkedAt: 1_042,
      latencyMs: 42,
      modelCount: 2
    })
  })

  it('classifies authentication failures without throwing from a connection test', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    } as Response)

    await expect(
      testProviderConnection(request('https://api.example.com/v1/models', 'bad-key'))
    ).resolves.toMatchObject({
      ok: false,
      code: 'authentication',
      status: 401,
      message: 'Fetch failed: 401 Unauthorized'
    })
  })

  it('reports successful responses with an empty model catalog', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    } as unknown as Response)

    await expect(
      testProviderConnection(request('https://api.example.com/v1/models'))
    ).resolves.toMatchObject({
      ok: false,
      code: 'empty_catalog',
      modelCount: 0
    })
  })

  it('classifies invalid JSON responses in connection diagnostics', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => '<html>not json</html>'
    } as unknown as Response)

    await expect(
      testProviderConnection(request('https://api.example.com/v1/models'))
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid_response'
    })
  })

  it('aborts and classifies connection tests that exceed the timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    const result = testProviderConnection(request('https://api.example.com/v1/models'))
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(result).resolves.toMatchObject({
      ok: false,
      code: 'timeout',
      latencyMs: 15_000
    })
  })
})
