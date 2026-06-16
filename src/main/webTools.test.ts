import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub DNS resolution so SSRF validation in the HTML fallback path treats hosts as public
// without performing real network lookups during tests.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}))

import {
  stripHtml,
  isPrivateIPv4,
  isPrivateIPv6,
  parseDuckDuckGoResults,
  parseBingResults,
  parseSogouResults,
  normalizeFetchUrlOptions,
  normalizeWebSearchOptions,
  webSearchDetailed,
  clearWebSearchCache,
  extractMainContentHtml,
  fetchUrl,
  setHtmlRenderer,
  hasHtmlRenderer
} from './webTools'

describe('stripHtml', () => {
  it('removes script/style content and surrounding tags', () => {
    const out = stripHtml('<p>Hello <b>World</b></p><script>steal()</script>')
    expect(out).toContain('Hello World')
    expect(out).not.toContain('steal')
  })

  it('decodes common HTML entities', () => {
    expect(stripHtml('a &amp; b')).toBe('a & b')
    expect(stripHtml('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0')
  })
})

describe('normalizeFetchUrlOptions', () => {
  it('defaults to the first fetch window', () => {
    expect(normalizeFetchUrlOptions()).toEqual({ offset: 0, maxChars: 10000 })
  })

  it('clamps offset and maxChars to safe page-window bounds', () => {
    expect(normalizeFetchUrlOptions({ offset: -50, maxChars: 100 })).toEqual({
      offset: 0,
      maxChars: 1000
    })
    expect(normalizeFetchUrlOptions({ offset: 42.9, maxChars: 25000 })).toEqual({
      offset: 42,
      maxChars: 16000
    })
  })
})

describe('isPrivateIPv4 (SSRF guard)', () => {
  it('flags private / reserved ranges', () => {
    for (const ip of [
      '10.0.0.1',
      '192.168.1.10',
      '127.0.0.1',
      '172.16.5.4',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0'
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIPv4(ip)).toBe(false)
    }
  })

  it('treats malformed input as private (fail closed)', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true)
    expect(isPrivateIPv4('1.2.3')).toBe(true)
  })
})

describe('isPrivateIPv6 (SSRF guard)', () => {
  it('flags loopback and unique-local / link-local ranges', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIPv6(ip)).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false)
  })
})

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
    expect(out.results[0]).toMatchObject({ title: 'Brave A', url: 'https://x.test', source: 'Brave' })
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

describe('extractMainContentHtml (readability-lite)', () => {
  it('prefers <article>/<main> and drops nav/footer chrome', () => {
    const html = `
      <html><body>
        <nav><a href="/a">Home</a><a href="/b">About</a> menu menu menu</nav>
        <header>Site banner advertisement</header>
        <main>
          <article>
            <h1>The Real Title</h1>
            <p>This is the substantial primary article content that we want to keep. It is long enough to dominate the page and be recognized as the main region by the density heuristic.</p>
            <p>A second paragraph with more meaningful body text to ensure the article block clearly wins.</p>
          </article>
        </main>
        <footer>copyright nav links privacy terms contact</footer>
      </body></html>`
    const main = extractMainContentHtml(html)
    expect(main).not.toBeNull()
    const text = stripHtml(main as string)
    expect(text).toContain('The Real Title')
    expect(text).toContain('primary article content')
    expect(text).not.toContain('About')
    expect(text).not.toContain('copyright')
  })

  it('returns null when there is no confident main region', () => {
    const html = '<html><body><div>short</div><div>bits</div></body></html>'
    expect(extractMainContentHtml(html)).toBeNull()
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

describe('parseDuckDuckGoResults', () => {
  const html = `
    <div class="serp__results">
      <div class="result__body web-result extra">
        <h2><a rel="noopener" class="result__a js-result" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=abc">First <b>Title</b></a></h2>
        <a class="result__snippet" href="#">Snippet one &amp; more</a>
      </div>
      <div class="result__body web-result">
        <h2><a class="result__a" href="https://example.org/page2">Second Title</a></h2>
        <a class="result__snippet">Snippet two</a>
      </div>
    </div>`

  it('extracts title, decoded redirect href, and snippet across blocks', () => {
    const results = parseDuckDuckGoResults(html)
    expect(results).toHaveLength(2)

    expect(results[0]).toEqual({
      title: 'First Title',
      url: 'https://example.com/page1',
      snippet: 'Snippet one & more',
      source: 'DuckDuckGo'
    })
    expect(results[1]).toEqual({
      title: 'Second Title',
      url: 'https://example.org/page2',
      snippet: 'Snippet two',
      source: 'DuckDuckGo'
    })
  })

  it('is resilient to attribute ordering on the anchor tag', () => {
    const reordered = `
      <div class="web-result">
        <a data-foo="bar" href="https://x.test/p" class="extra result__a">Reordered</a>
      </div>`
    const results = parseDuckDuckGoResults(reordered)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://x.test/p')
    expect(results[0].title).toBe('Reordered')
    expect(results[0].source).toBe('DuckDuckGo')
  })

  it('returns an empty array when the markup matches nothing', () => {
    expect(parseDuckDuckGoResults('<html><body>no results</body></html>')).toEqual([])
  })
})

describe('parseBingResults', () => {
  const html = `
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://bing1.test/x">Bing One</a></h2>
        <div class="b_caption"><p>Caption one</p></div>
      </li>
      <li class="b_algo b_ad">
        <h2><a target="_blank" href="https://bing2.test/y">Bing Two</a></h2>
        <p>Direct para two</p>
      </li>
    </ol>`

  it('extracts results from b_algo blocks', () => {
    const results = parseBingResults(html)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'Bing One',
      url: 'https://bing1.test/x',
      snippet: 'Caption one',
      source: 'Bing'
    })
    expect(results[1]).toEqual({
      title: 'Bing Two',
      url: 'https://bing2.test/y',
      snippet: 'Direct para two',
      source: 'Bing'
    })
  })
})

describe('parseSogouResults', () => {
  const html = `
    <div class="results">
      <div class="vrwrap">
        <h3 class="vr-title"><a href="/link?url=hedJjaC291Abc">Sogou <em>One</em></a></h3>
        <div class="str_info">Snippet one here</div>
      </div>
      <div class="vrwrap">
        <h3><a href="https://direct.test/z">Sogou Two</a></h3>
      </div>
    </div>`

  it('resolves redirect-wrapped relative hrefs against sogou.com', () => {
    const results = parseSogouResults(html)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Sogou One')
    expect(results[0].url).toBe('https://www.sogou.com/link?url=hedJjaC291Abc')
    expect(results[0].snippet).toBe('Snippet one here')
    expect(results[0].source).toBe('Sogou')
  })

  it('keeps absolute hrefs untouched', () => {
    const results = parseSogouResults(html)
    expect(results[1].url).toBe('https://direct.test/z')
    expect(results[1].source).toBe('Sogou')
  })

  it('returns an empty array for non-matching markup', () => {
    expect(parseSogouResults('<div>nothing</div>')).toEqual([])
  })
})
