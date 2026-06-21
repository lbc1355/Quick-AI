import { lookup } from 'dns/promises'
import {
  isPrivateIPv4,
  isPrivateIPv6,
  normalizeFetchUrlOptions,
  type FetchUrlOptions
} from './web/urlSafety'
import {
  extractMainContentHtml,
  stripHtml,
  stripHtmlWithLinks,
  type WebLink
} from './web/htmlExtract'
import {
  parseBingResults,
  parseDuckDuckGoResults,
  parseSogouResults,
  type WebSearchResult
} from './web/searchParsers'

export {
  isPrivateIPv4,
  isPrivateIPv6,
  normalizeFetchUrlOptions,
  type FetchUrlOptions
} from './web/urlSafety'
export {
  extractMainContentHtml,
  renderWithLineNumbers,
  stripHtml,
  stripHtmlWithLinks,
  type WebLink
} from './web/htmlExtract'
export {
  formatSearchResultsForModel,
  parseBingResults,
  parseDuckDuckGoResults,
  parseSogouResults,
  type WebSearchResult
} from './web/searchParsers'

export interface FetchUrlResult {
  url: string
  finalUrl: string
  title: string
  text: string
  links: WebLink[]
  truncated: boolean
  offset: number
  endOffset: number
  totalChars: number
  nextOffset?: number
  responseTruncated: boolean
  /** True when the page content was produced by the JS-rendering (headless browser) path. */
  rendered: boolean
}

const MAX_RESPONSE_BYTES = 800 * 1024
const REQUEST_TIMEOUT_MS = 10000
const MAX_REDIRECTS = 4

// JS-rendering seam
// webTools.ts must stay free of any electron import so it remains unit-testable in plain node.
// The main process injects a headless renderer (hidden BrowserWindow) at startup via
// setHtmlRenderer; when absent, the JS-rendering path is simply unavailable and fetch falls back
// to raw HTTP HTML.
export interface HtmlRenderResult {
  finalUrl: string
  html: string
}

export type HtmlRenderer = (url: string, signal?: AbortSignal) => Promise<HtmlRenderResult>

let injectedHtmlRenderer: HtmlRenderer | null = null

export const setHtmlRenderer = (renderer: HtmlRenderer | null): void => {
  injectedHtmlRenderer = renderer
}

export const hasHtmlRenderer = (): boolean => injectedHtmlRenderer !== null

// A statically rendered page that yields very little text is a likely client-rendered (SPA)
// shell; when a renderer is available we retry through it.
const RENDER_FALLBACK_MIN_CHARS = 200

// Rewrite known academic paper PDF URLs to their HTML abstract pages so the
// fetch returns lightweight text instead of a multi-MB binary PDF.
const rewriteAcademicPaperUrl = (rawUrl: string): string => {
  const parsed = ((): URL | null => {
    try {
      return new URL(rawUrl)
    } catch {
      return null
    }
  })()
  if (!parsed) return rawUrl

  // arXiv: /pdf/XXXX.XXXX -> /abs/XXXX.XXXX
  if (
    (parsed.hostname === 'arxiv.org' || parsed.hostname.endsWith('.arxiv.org')) &&
    parsed.pathname.startsWith('/pdf/')
  ) {
    const id = parsed.pathname.replace(/^\/pdf\//, '')
    const newUrl = `https://arxiv.org/abs/${id}`
    console.log(`[fetch_url] Rewriting arXiv PDF URL -> abstract page: ${rawUrl} -> ${newUrl}`)
    return newUrl
  }

  return rawUrl
}

const validatePublicHttpUrl = async (rawUrl: string): Promise<URL> => {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed')
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) {
    throw new Error('Unable to resolve URL hostname')
  }

  const hasPrivateAddress = addresses.some((entry) => {
    if (entry.family === 4) return isPrivateIPv4(entry.address)
    if (entry.family === 6) return isPrivateIPv6(entry.address)
    return true
  })
  if (hasPrivateAddress) {
    throw new Error('Private network URLs are not allowed')
  }

  return parsed
}

const fetchWithCheckedRedirects = async (
  rawUrl: string,
  signal: AbortSignal,
  redirects = 0,
  headers?: Record<string, string>
): Promise<Response> => {
  const parsed = await validatePublicHttpUrl(rawUrl)
  const response = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...headers
    }
  })

  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) {
      throw new Error('Too many redirects')
    }
    const location = response.headers.get('location')
    if (!location) {
      throw new Error(`Redirect response missing location header: ${response.status}`)
    }
    const nextUrl = new URL(location, parsed).toString()
    return fetchWithCheckedRedirects(nextUrl, signal, redirects + 1, headers)
  }

  return response
}

const readLimitedText = async (
  response: Response
): Promise<{ text: string; truncated: boolean }> => {
  // Reject binary (non-text) responses early so the caller gets a clear error
  // instead of garbled binary data decoded as UTF-8.
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (
    contentType &&
    !contentType.includes('text/') &&
    !contentType.includes('html') &&
    !contentType.includes('xml') &&
    !contentType.includes('json')
  ) {
    throw new Error(
      `Cannot fetch binary content (${contentType || 'unknown content type'}). ` +
        `Use an abstract/HTML page instead of a PDF. For arXiv, replace "/pdf/" with "/abs/" in the URL.`
    )
  }

  const reader = response.body?.getReader()
  if (!reader) {
    return { text: '', truncated: false }
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      truncated = true
      const allowedBytes = value.byteLength - (totalBytes - MAX_RESPONSE_BYTES)
      if (allowedBytes > 0) {
        chunks.push(value.slice(0, allowedBytes))
      }
      await reader.cancel()
      break
    }
    chunks.push(value)
  }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  return {
    text:
      chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode(),
    truncated
  }
}

/** Options accepted by the high-level webSearch entry point. */
export interface WebSearchOptions {
  /** Max number of results to return. Clamped 1..20. Default 8. */
  count?: number
  /** Recency filter. 'day' | 'week' | 'month' | 'year' | 'all'. Default 'all'. */
  freshness?: SearchFreshness
  /** UI/Accept-Language hint, e.g. 'zh-CN' or 'en-US'. */
  lang?: string
  /** Provider selection + credentials, normally sourced from app settings. */
  config?: WebSearchProviderConfig
}

export type SearchFreshness = 'day' | 'week' | 'month' | 'year' | 'all'

export type WebSearchProviderType = 'auto' | 'html' | 'tavily' | 'brave'

export interface WebSearchProviderConfig {
  provider: WebSearchProviderType
  apiKey?: string
}

const DEFAULT_SEARCH_COUNT = 8
const MAX_SEARCH_COUNT = 20

export const normalizeWebSearchOptions = (
  options: WebSearchOptions = {}
): { count: number; freshness: SearchFreshness; lang: string } => {
  const rawCount = typeof options.count === 'number' ? options.count : DEFAULT_SEARCH_COUNT
  const count = Number.isFinite(rawCount)
    ? Math.min(MAX_SEARCH_COUNT, Math.max(1, Math.floor(rawCount)))
    : DEFAULT_SEARCH_COUNT

  const allowedFreshness: SearchFreshness[] = ['day', 'week', 'month', 'year', 'all']
  const freshness =
    options.freshness && allowedFreshness.includes(options.freshness) ? options.freshness : 'all'

  const lang = typeof options.lang === 'string' && options.lang.trim() ? options.lang.trim() : ''

  return { count, freshness, lang }
}

const readTitle = (html: string): string => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return titleMatch ? stripHtml(titleMatch[1]).slice(0, 160) : ''
}

function createCombinedSignal(
  externalSignal?: AbortSignal,
  timeoutMs = 10000
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()

  const onExternalAbort = (): void => {
    controller.abort(externalSignal?.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onExternalAbort)
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  const cleanup = (): void => {
    clearTimeout(timeoutId)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  return {
    signal: controller.signal,
    cleanup
  }
}

export const fetchPublicText = async (
  rawUrl: string,
  signal?: AbortSignal
): Promise<{ finalUrl: string; text: string; truncated: boolean }> => {
  const rewrittenUrl = rewriteAcademicPaperUrl(rawUrl)
  const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchWithCheckedRedirects(rewrittenUrl, combinedSignal)
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
    }

    const finalUrl = response.url || rawUrl
    await validatePublicHttpUrl(finalUrl)
    const { text: rawText, truncated } = await readLimitedText(response)
    return { finalUrl, text: rawText, truncated }
  } finally {
    cleanup()
  }
}

// Turn raw HTML (or plain text) into the readable, link-annotated text we feed the model.
// Applies Readability-lite main-content extraction for HTML before link-aware stripping.
const htmlToReadableText = (
  rawText: string,
  finalUrl: string
): { title: string; text: string; links: WebLink[] } => {
  const isHtml = /<html[\s>]/i.test(rawText) || /<body[\s>]/i.test(rawText)
  if (!isHtml) {
    return { title: '', text: rawText.trim(), links: [] }
  }
  const title = readTitle(rawText)
  const mainHtml = extractMainContentHtml(rawText)
  const { text, links } = stripHtmlWithLinks(mainHtml ?? rawText, finalUrl)
  // Guard against over-aggressive extraction: if the extracted region is suspiciously short
  // compared to a whole-page strip, prefer the whole page.
  if (mainHtml) {
    const whole = stripHtmlWithLinks(rawText, finalUrl)
    if (whole.text.length > text.length * 2 && text.length < 500) {
      return { title, text: whole.text, links: whole.links }
    }
  }
  return { title, text, links }
}

export const fetchUrl = async (
  rawUrl: string,
  signal?: AbortSignal,
  options: FetchUrlOptions = {}
): Promise<FetchUrlResult> => {
  let rendered = false
  let finalUrl: string
  let title: string
  let fullText: string
  let links: WebLink[]
  let responseTruncated = false

  const wantsRender = options.render === true && hasHtmlRenderer()

  if (wantsRender && injectedHtmlRenderer) {
    const r = await injectedHtmlRenderer(rewriteAcademicPaperUrl(rawUrl), signal)
    finalUrl = r.finalUrl
    const parsed = htmlToReadableText(r.html, finalUrl)
    title = parsed.title
    fullText = parsed.text
    links = parsed.links
    rendered = true
  } else {
    const fetched = await fetchPublicText(rawUrl, signal)
    finalUrl = fetched.finalUrl
    responseTruncated = fetched.truncated
    const parsed = htmlToReadableText(fetched.text, finalUrl)
    title = parsed.title
    fullText = parsed.text
    links = parsed.links

    // Auto-fallback: a near-empty static page with a renderer available is likely a JS shell.
    if (
      !options.render &&
      fullText.length < RENDER_FALLBACK_MIN_CHARS &&
      hasHtmlRenderer() &&
      injectedHtmlRenderer &&
      !signal?.aborted
    ) {
      try {
        const r = await injectedHtmlRenderer(rewriteAcademicPaperUrl(finalUrl), signal)
        const reparsed = htmlToReadableText(r.html, r.finalUrl)
        if (reparsed.text.length > fullText.length) {
          finalUrl = r.finalUrl
          title = reparsed.title || title
          fullText = reparsed.text
          links = reparsed.links
          rendered = true
        }
      } catch (err) {
        console.warn(
          '[fetch_url] JS-render fallback failed; using static HTML.',
          (err as Error).message
        )
      }
    }
  }

  const { offset, maxChars } = normalizeFetchUrlOptions(options)
  const totalChars = fullText.length
  const boundedOffset = Math.min(offset, totalChars)
  const endOffset = Math.min(boundedOffset + maxChars, totalChars)
  const text = fullText.slice(boundedOffset, endOffset)
  const nextOffset = endOffset < totalChars ? endOffset : undefined

  return {
    url: rawUrl,
    finalUrl,
    title,
    text,
    links,
    truncated: nextOffset !== undefined,
    offset: boundedOffset,
    endOffset,
    totalChars,
    nextOffset,
    responseTruncated,
    rendered
  }
}

const SEARCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

interface SearchEngine {
  name: 'Bing' | 'Sogou' | 'DuckDuckGo'
  buildUrl: (query: string, freshness: SearchFreshness) => string
  parse: (html: string, limit: number) => WebSearchResult[]
}

// Bing supports a freshness query-string filter (interval days); other engines ignore it.
const bingFreshnessParam = (freshness: SearchFreshness): string => {
  switch (freshness) {
    case 'day':
      return '&filters=ex1%3a%22ez1%22'
    case 'week':
      return '&filters=ex1%3a%22ez2%22'
    case 'month':
      return '&filters=ex1%3a%22ez3%22'
    default:
      return ''
  }
}

// Ordered by observed reliability: Bing international returns direct (non-wrapped)
// links and rarely rate-limits; Sogou is a China-accessible fallback; DuckDuckGo's
// HTML endpoint frequently answers 202 (rate-limited) so it sits last.
const SEARCH_ENGINES: SearchEngine[] = [
  {
    name: 'Bing',
    buildUrl: (q, freshness) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}${bingFreshnessParam(freshness)}`,
    parse: parseBingResults
  },
  {
    name: 'Sogou',
    buildUrl: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
    parse: parseSogouResults
  },
  {
    name: 'DuckDuckGo',
    buildUrl: (q, freshness) => {
      const df =
        freshness === 'day'
          ? '&df=d'
          : freshness === 'week'
            ? '&df=w'
            : freshness === 'month'
              ? '&df=m'
              : freshness === 'year'
                ? '&df=y'
                : ''
      return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}${df}`
    },
    parse: parseDuckDuckGoResults
  }
]

const buildSearchHeaders = (lang: string): Record<string, string> => ({
  ...SEARCH_HEADERS,
  'Accept-Language': lang
    ? `${lang},${lang.split('-')[0]};q=0.9,en;q=0.8`
    : SEARCH_HEADERS['Accept-Language']
})

const fetchSearchHtml = async (url: string, signal?: AbortSignal, lang = ''): Promise<string> => {
  const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchWithCheckedRedirects(
      url,
      combinedSignal,
      0,
      buildSearchHeaders(lang)
    )
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const { text } = await readLimitedText(response)
    return text
  } finally {
    cleanup()
  }
}

// Search providers
// A SearchProvider abstracts a search backend. The built-in HTML provider scrapes the public
// search engines; the API providers (Tavily, Brave) call dedicated LLM-friendly search APIs and
// return cleaner results plus, for Tavily, an optional aggregated answer. Provider selection is
// driven by app settings; with no API key we fall back to the HTML provider so search always
// works out of the box.

export interface SearchProviderResult {
  results: WebSearchResult[]
  /** Some API providers (Tavily) can return a synthesized direct answer. */
  answer?: string
  /** Which provider actually produced the results (after auto-resolution / fallback). */
  provider: string
}

interface SearchProvider {
  name: string
  search: (
    query: string,
    opts: { count: number; freshness: SearchFreshness; lang: string },
    apiKey: string,
    signal?: AbortSignal
  ) => Promise<SearchProviderResult>
}

// Built-in HTML scraping provider: tries each engine in order and returns the first that yields
// results. Engines that error, rate-limit, or parse to zero results are skipped so a single
// flaky engine no longer leaves the agent with nothing.
const htmlSearchProvider: SearchProvider = {
  name: 'html',
  search: async (query, opts, _apiKey, signal) => {
    const failures: string[] = []
    for (const engine of SEARCH_ENGINES) {
      if (signal?.aborted) throw new Error('Search aborted by user.')
      try {
        const html = await fetchSearchHtml(
          engine.buildUrl(query, opts.freshness),
          signal,
          opts.lang
        )
        const results = engine.parse(html, opts.count)
        if (results.length > 0) {
          return {
            results: results.map((r) => ({ ...r, source: engine.name })),
            provider: 'html'
          }
        }
        failures.push(`${engine.name}: no results (markup may have changed)`)
      } catch (error) {
        const err = error as Error
        failures.push(`${engine.name}: ${err.message}`)
        console.warn(`Search engine "${engine.name}" failed, trying next. Error:`, err.message)
      }
    }
    throw new Error(
      `No search results from any HTML engine for query: "${query}". Tried 鈥?${failures.join('; ')}`
    )
  }
}

const TAVILY_FRESHNESS_DAYS: Record<SearchFreshness, number | undefined> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
  all: undefined
}

const tavilySearchProvider: SearchProvider = {
  name: 'tavily',
  search: async (query, opts, apiKey, signal) => {
    if (!apiKey) throw new Error('Tavily provider requires an API key.')
    const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)
    try {
      const body: Record<string, unknown> = {
        query,
        max_results: opts.count,
        include_answer: true,
        search_depth: 'basic'
      }
      const days = TAVILY_FRESHNESS_DAYS[opts.freshness]
      if (days !== undefined) {
        body.topic = 'news'
        body.days = days
      }
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: combinedSignal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `Tavily API error ${response.status} ${response.statusText} ${detail}`.trim()
        )
      }
      const data = (await response.json()) as {
        answer?: string
        results?: Array<{ title?: string; url?: string; content?: string }>
      }
      const results: WebSearchResult[] = (data.results || [])
        .filter((r) => r.url)
        .slice(0, opts.count)
        .map((r) => ({
          title: (r.title || r.url || '').slice(0, 200),
          url: r.url as string,
          snippet: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 500),
          source: 'Tavily' as const
        }))
      return { results, answer: data.answer?.trim() || undefined, provider: 'tavily' }
    } finally {
      cleanup()
    }
  }
}

const BRAVE_FRESHNESS_PARAM: Record<SearchFreshness, string | undefined> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
  all: undefined
}

const braveSearchProvider: SearchProvider = {
  name: 'brave',
  search: async (query, opts, apiKey, signal) => {
    if (!apiKey) throw new Error('Brave provider requires an API key.')
    const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)
    try {
      const params = new URLSearchParams({
        q: query,
        count: String(opts.count)
      })
      const freshness = BRAVE_FRESHNESS_PARAM[opts.freshness]
      if (freshness) params.set('freshness', freshness)
      if (opts.lang) params.set('search_lang', opts.lang.split('-')[0])
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        method: 'GET',
        signal: combinedSignal,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey
        }
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `Brave API error ${response.status} ${response.statusText} ${detail}`.trim()
        )
      }
      const data = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
      }
      const results: WebSearchResult[] = (data.web?.results || [])
        .filter((r) => r.url)
        .slice(0, opts.count)
        .map((r) => ({
          title: (r.title || r.url || '').replace(/<[^>]+>/g, '').slice(0, 200),
          url: r.url as string,
          snippet: (r.description || '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500),
          source: 'Brave' as const
        }))
      return { results, provider: 'brave' }
    } finally {
      cleanup()
    }
  }
}

const API_PROVIDERS: Record<string, SearchProvider> = {
  tavily: tavilySearchProvider,
  brave: braveSearchProvider
}

/** Resolve which provider to run given config. 'auto' picks an API provider when a key exists. */
const resolveProvider = (
  config?: WebSearchProviderConfig
): { provider: SearchProvider; apiKey: string } => {
  const type = config?.provider || 'auto'
  const apiKey = config?.apiKey || ''

  if (type === 'tavily' || type === 'brave') {
    return { provider: API_PROVIDERS[type], apiKey }
  }
  if (type === 'auto' && apiKey) {
    // Default the auto API choice to Tavily (answer support); callers wanting Brave set it explicitly.
    return { provider: tavilySearchProvider, apiKey }
  }
  return { provider: htmlSearchProvider, apiKey: '' }
}

// Search result cache
// Short-lived in-memory cache keyed by (provider, normalized query, count, freshness, lang).
// Identical searches within a task are common; caching avoids hammering engines/APIs and pairs
// well with the loop guard. TTL is intentionally short so results stay reasonably fresh.

interface SearchCacheEntry {
  expiresAt: number
  value: SearchProviderResult
}

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 100
const searchCache = new Map<string, SearchCacheEntry>()

const buildCacheKey = (
  providerName: string,
  query: string,
  opts: { count: number; freshness: SearchFreshness; lang: string }
): string =>
  `${providerName}::${query.trim().toLowerCase()}::${opts.count}::${opts.freshness}::${opts.lang}`

export const clearWebSearchCache = (): void => {
  searchCache.clear()
}

/**
 * High-level web search entry point. Resolves a provider from config (API when a key is present,
 * else built-in HTML scraping), serves from a short-lived cache when possible, and on API
 * provider failure transparently falls back to the HTML provider so search never hard-fails when
 * a network/API hiccup occurs.
 */
export const webSearchDetailed = async (
  query: string,
  signal?: AbortSignal,
  options: WebSearchOptions = {}
): Promise<SearchProviderResult> => {
  const cleanQuery = query.slice(0, 300)
  const opts = normalizeWebSearchOptions(options)
  const { provider, apiKey } = resolveProvider(options.config)

  const cacheKey = buildCacheKey(provider.name, cleanQuery, opts)
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const store = (value: SearchProviderResult): SearchProviderResult => {
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value })
    // FIFO eviction past the cap.
    if (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = searchCache.keys().next().value as string
      searchCache.delete(oldest)
    }
    return value
  }

  try {
    const result = await provider.search(cleanQuery, opts, apiKey, signal)
    if (result.results.length === 0 && provider.name !== 'html') {
      // Empty API result: fall back to HTML scraping rather than returning nothing.
      const fallback = await htmlSearchProvider.search(cleanQuery, opts, '', signal)
      return store({ ...fallback, provider: `${provider.name}->html` })
    }
    return store(result)
  } catch (error) {
    if (signal?.aborted) throw error
    if (provider.name !== 'html') {
      console.warn(
        `Search provider "${provider.name}" failed, falling back to HTML scraping:`,
        (error as Error).message
      )
      const fallback = await htmlSearchProvider.search(cleanQuery, opts, '', signal)
      return store({ ...fallback, provider: `${provider.name}->html` })
    }
    throw error
  }
}

// Backward-compatible thin wrapper returning just the result list.
export const webSearch = async (
  query: string,
  signal?: AbortSignal,
  options: WebSearchOptions = {}
): Promise<WebSearchResult[]> => {
  const detailed = await webSearchDetailed(query, signal, options)
  return detailed.results
}
