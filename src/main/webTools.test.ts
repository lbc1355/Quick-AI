import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub DNS resolution so SSRF validation in the HTML fallback path treats hosts as public
// without performing real network lookups during tests.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}))

import {
  normalizeWebSearchOptions,
  webSearchDetailed,
  clearWebSearchCache,
  fetchUrl,
  setHtmlRenderer,
  hasHtmlRenderer
} from './webTools'

describe('normalizeWebSearchOptions', () => {
  it('applies defaults', () => {
    expect(normalizeWebSearchOptions()).toEqual({ count: 8, freshness: 'all', lang: '' })
  })

  it('clamps count to 1..20 and floors floats', () => {
    expect(normalizeWebSearchOptions({ count: 0 }).count).toBe(1)
    expect(normalizeWebSearchOptions({ count: 100 }).count).toBe(20)
    expect(normalizeWebSearchOptions({ count: 5.9 }).count).toBe(5)
  })

  it('rejects unknown freshness values', () => {
    expect(normalizeWebSearchOptions({ freshness: 'decade' as never }).freshness).toBe('all')
    expect(normalizeWebSearchOptions({ freshness: 'week' }).freshness).toBe('week')
  })

  it('trims lang and ignores blank', () => {
    expect(normalizeWebSearchOptions({ lang: '  en-US ' }).lang).toBe('en-US')
    expect(normalizeWebSearchOptions({ lang: '   ' }).lang).toBe('')
  })
})

describe('webSearchDetailed providers', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    clearWebSearchCache()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    clearWebSearchCache()
  })

  it('uses the Tavily API when provider is tavily and returns its answer', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('api.tavily.com')
      return new Response(
        JSON.stringify({
          answer: 'The aggregated answer.',
          results: [
            { title: 'Result A', url: 'https://a.test', content: 'content a' },
            { title: 'Result B', url: 'https://b.test', content: 'content b' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const out = await webSearchDetailed('hello', undefined, {
      config: { provider: 'tavily', apiKey: 'tvly-key' }
    })

    expect(out.provider).toBe('tavily')
    expect(out.answer).toBe('The aggregated answer.')
    expect(out.results).toHaveLength(2)
    expect(out.results[0]).toMatchObject({
      title: 'Result A',
      url: 'https://a.test',
      source: 'Tavily'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the Brave API when provider is brave', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain('api.search.brave.com')
      expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-key')
      return new Response(
        JSON.stringify({
          web: {
            results: [{ title: 'Brave A', url: 'https://x.test', description: 'desc <b>a</b>' }]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const out = await webSearchDetailed('hello', undefined, {
      config: { provider: 'brave', apiKey: 'brave-key' }
    })

    expect(out.provider).toBe('brave')
    expect(out.results[0]).toMatchObject({
      title: 'Brave A',
      url: 'https://x.test',
      source: 'Brave'
    })
    // HTML tags stripped from description
    expect(out.results[0].snippet).toBe('desc a')
  })

  it('falls back to HTML scraping when the API provider throws', async () => {
    const bingHtml = `
      <li class="b_algo">
        <h2><a href="https://fallback.test/x">Fallback Hit</a></h2>
        <p>fallback snippet</p>
      </li>`
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('api.tavily.com')) {
        return new Response('rate limited', { status: 429 })
      }
      // HTML engine request (Bing first)
      return new Response(bingHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const out = await webSearchDetailed('hello', undefined, {
      config: { provider: 'tavily', apiKey: 'tvly-key' }
    })

    expect(out.provider).toBe('tavily->html')
    expect(out.results[0]).toMatchObject({ url: 'https://fallback.test/x', source: 'Bing' })
  })

  it('serves identical repeat searches from cache (no second fetch)', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ answer: 'cached', results: [{ title: 'T', url: 'https://c.test' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const opts = { config: { provider: 'tavily' as const, apiKey: 'k' } }
    const first = await webSearchDetailed('same query', undefined, opts)
    const second = await webSearchDetailed('same query', undefined, opts)

    expect(first.results).toEqual(second.results)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses HTML provider when auto has no API key', async () => {
    const bingHtml = `
      <li class="b_algo">
        <h2><a href="https://auto.test/x">Auto Hit</a></h2>
        <p>auto snippet</p>
      </li>`
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).not.toContain('api.tavily.com')
      return new Response(bingHtml, { status: 200, headers: { 'content-type': 'text/html' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const out = await webSearchDetailed('hello', undefined, { config: { provider: 'auto' } })
    expect(out.provider).toBe('html')
    expect(out.results[0]).toMatchObject({ url: 'https://auto.test/x' })
  })
})

describe('fetchUrl JS-render seam', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    setHtmlRenderer(null)
    vi.restoreAllMocks()
  })

  it('uses the injected renderer when render:true is requested', async () => {
    const renderer = vi.fn(async (url: string) => ({
      finalUrl: url,
      html: '<html><body><main><p>Rendered SPA content that is long enough to be the main region of the document.</p></main></body></html>'
    }))
    setHtmlRenderer(renderer)
    expect(hasHtmlRenderer()).toBe(true)

    const out = await fetchUrl('https://spa.test/page', undefined, { render: true })
    expect(renderer).toHaveBeenCalledOnce()
    expect(out.rendered).toBe(true)
    expect(out.text).toContain('Rendered SPA content')
  })

  it('auto-falls back to rendering when static HTML is near-empty', async () => {
    globalThis.fetch = vi.fn(async () => {
      // Static shell with essentially no body text.
      return new Response('<html><body><div id="app"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    }) as unknown as typeof fetch

    const renderer = vi.fn(async (url: string) => ({
      finalUrl: url,
      html: '<html><body><article><p>Hydrated content that only appears after JavaScript executes, which is plenty long to win.</p></article></body></html>'
    }))
    setHtmlRenderer(renderer)

    const out = await fetchUrl('https://spa.test/empty', undefined, {})
    expect(renderer).toHaveBeenCalledOnce()
    expect(out.rendered).toBe(true)
    expect(out.text).toContain('Hydrated content')
  })

  it('does not render when no renderer is registered', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        '<html><body><main><p>Plenty of static server-rendered content here that is long enough to be the main region.</p></main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    }) as unknown as typeof fetch
    setHtmlRenderer(null)
    expect(hasHtmlRenderer()).toBe(false)

    const out = await fetchUrl('https://static.test/page', undefined, {})
    expect(out.rendered).toBe(false)
    expect(out.text).toContain('static server-rendered content')
  })
})
