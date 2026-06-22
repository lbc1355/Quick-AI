import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchModels } from './aiClient'

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

    await expect(fetchModels('https://api.example.com/v1/models', 'key')).resolves.toEqual([
      { id: 'model-a', contextWindowTokens: 128000 },
      { id: 'model-b', contextWindowTokens: 64000 },
      { id: 'model-c' }
    ])
  })

  it('keeps compatibility with array string responses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ['model-a', 'model-b']
    } as unknown as Response)

    await expect(fetchModels('https://api.example.com/v1/models', '')).resolves.toEqual([
      { id: 'model-a' },
      { id: 'model-b' }
    ])
  })
})
