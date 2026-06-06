import { lookup } from 'dns/promises'

export interface WebLink {
  text: string
  href: string
}

export interface FetchUrlResult {
  url: string
  finalUrl: string
  title: string
  text: string
  links: WebLink[]
  truncated: boolean
}

const MAX_RESPONSE_BYTES = 800 * 1024
const REQUEST_TIMEOUT_MS = 10000
const MAX_REDIRECTS = 4
const MAX_LINKS = 40
const MAX_TEXT_CHARS = 18000

export const isPrivateIPv4 = (address: string): boolean => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true
  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

export const isPrivateIPv6 = (address: string): boolean => {
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  )
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
  const contentLength = Number(response.headers.get('content-length') || '0')
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response too large: ${contentLength} bytes`)
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

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
}

export const stripHtml = (html: string): string => {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  ).trim()
}

export interface SearchResult {
  title: string
  href: string
  snippet: string
}

// Pure parser for the DuckDuckGo HTML endpoint (html.duckduckgo.com/html). Kept
// separate from fetching so it can be regression-tested against captured markup —
// DuckDuckGo's class/attribute layout has shifted before and broken this silently.
export const parseDuckDuckGoResults = (html: string, limit = 8): SearchResult[] => {
  const results: SearchResult[] = []
  const blocks = html.split(/<div\s+class="[^"]*web-result[^"]*"/i)
  for (let i = 1; i < blocks.length && results.length < limit; i++) {
    const block = blocks[i]

    // Robustly match the link tag containing class "result__a"
    const aMatch = block.match(/<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue

    const fullLinkTag = aMatch[0]
    const titleHtml = aMatch[1]

    const hrefMatch = fullLinkTag.match(/href="([^"]+)"/i)
    let href = hrefMatch ? hrefMatch[1] : ''

    if (href.startsWith('//')) {
      href = 'https:' + href
    }

    if (href.includes('/l/?')) {
      const uddgMatch = href.match(/[?&]uddg=([^&]+)/)
      if (uddgMatch) {
        href = decodeURIComponent(uddgMatch[1])
      }
    }

    const title = stripHtml(titleHtml).replace(/\s+/g, ' ').trim()

    // Robustly match the snippet tag containing class "result__snippet"
    const snippetMatch = block.match(
      /<a\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i
    )
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).replace(/\s+/g, ' ').trim() : ''

    results.push({ title, href, snippet })
  }
  return results
}

// Pure parser for Bing's HTML results page (used as a fallback search engine).
export const parseBingResults = (html: string, limit = 8): SearchResult[] => {
  const results: SearchResult[] = []
  const blocks = html.split(/<li\s+class="[^"]*b_algo[^"]*"/i)
  for (let i = 1; i < blocks.length && results.length < limit; i++) {
    const block = blocks[i]
    const h2Match = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
    if (!h2Match) continue

    const h2Content = h2Match[1]
    const aMatch = h2Content.match(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue

    const href = aMatch[1]
    const title = stripHtml(aMatch[2]).replace(/\s+/g, ' ').trim()

    const pMatch =
      block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<div\s+class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const snippet = pMatch ? stripHtml(pMatch[1]).replace(/\s+/g, ' ').trim() : ''

    if (href && title) {
      results.push({ title, href, snippet })
    }
  }
  return results
}

// Pure parser for Sogou's results page (used as a China-accessible fallback when
// DuckDuckGo is rate-limited). Title links are wrapped in Sogou redirect paths
// (/link?url=...), so relative hrefs are resolved against the sogou.com origin.
export const parseSogouResults = (html: string, limit = 8): SearchResult[] => {
  const results: SearchResult[] = []
  const blocks = html.split(/<div\s+class="vrwrap"/i)
  for (let i = 1; i < blocks.length && results.length < limit; i++) {
    const block = blocks[i]
    const h3Match = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (!h3Match) continue

    const aMatch = h3Match[1].match(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue

    let href = aMatch[1]
    if (href.startsWith('/')) {
      href = 'https://www.sogou.com' + href
    }
    const title = stripHtml(aMatch[2]).replace(/\s+/g, ' ').trim()

    const snippetMatch = block.match(
      /<div\s+class="[^"]*(?:str_info|fz-mid|text-layout)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    )
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).replace(/\s+/g, ' ').trim() : ''

    if (href && title) {
      results.push({ title, href, snippet })
    }
  }
  return results
}

const formatSearchResults = (results: SearchResult[]): string =>
  results
    .map((r, idx) => `${idx + 1}. ${r.title}\n   URL: ${r.href}\n   Snippet: ${r.snippet}`)
    .join('\n\n')

const readTitle = (html: string): string => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return titleMatch ? stripHtml(titleMatch[1]).slice(0, 160) : ''
}

const extractLinks = (html: string, baseUrl: string): WebLink[] => {
  const links: WebLink[] = []
  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorRegex.exec(html)) && links.length < MAX_LINKS) {
    const anchor = match[0]
    const hrefMatch = anchor.match(/\shref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const rawHref = hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || ''
    if (!rawHref || rawHref.startsWith('#')) continue

    try {
      const href = new URL(decodeHtmlEntities(rawHref), baseUrl)
      if (href.protocol !== 'http:' && href.protocol !== 'https:') continue
      const text = stripHtml(match[1]).replace(/\s+/g, ' ').slice(0, 160)
      if (!text && links.some((link) => link.href === href.toString())) continue
      links.push({ text: text || href.hostname, href: href.toString() })
    } catch {
      // Ignore malformed links.
    }
  }

  return links
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
  const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchWithCheckedRedirects(rawUrl, combinedSignal)
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

export const fetchUrl = async (rawUrl: string, signal?: AbortSignal): Promise<FetchUrlResult> => {
  const { finalUrl, text: rawText, truncated } = await fetchPublicText(rawUrl, signal)
  const isHtml = /<html[\s>]/i.test(rawText)
  const title = isHtml ? readTitle(rawText) : ''
  const text = isHtml ? stripHtml(rawText) : rawText.trim()
  const links = isHtml ? extractLinks(rawText, finalUrl) : []

  return {
    url: rawUrl,
    finalUrl,
    title,
    text: text.slice(0, MAX_TEXT_CHARS),
    links,
    truncated: truncated || text.length > MAX_TEXT_CHARS
  }
}

const SEARCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

interface SearchEngine {
  name: string
  buildUrl: (query: string) => string
  parse: (html: string) => SearchResult[]
}

// Ordered by observed reliability: Bing international returns direct (non-wrapped)
// links and rarely rate-limits; Sogou is a China-accessible fallback; DuckDuckGo's
// HTML endpoint frequently answers 202 (rate-limited) so it sits last.
const SEARCH_ENGINES: SearchEngine[] = [
  {
    name: 'Bing',
    buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBingResults
  },
  {
    name: 'Sogou',
    buildUrl: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
    parse: parseSogouResults
  },
  {
    name: 'DuckDuckGo',
    buildUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGoResults
  }
]

const fetchSearchHtml = async (url: string, signal?: AbortSignal): Promise<string> => {
  const { signal: combinedSignal, cleanup } = createCombinedSignal(signal, REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchWithCheckedRedirects(url, combinedSignal, 0, SEARCH_HEADERS)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const { text } = await readLimitedText(response)
    return text
  } finally {
    cleanup()
  }
}

// Try each engine in order and return the first that yields results. Engines that
// error, rate-limit, or parse to zero results are skipped so a single flaky engine
// no longer leaves the agent with nothing.
export const webSearch = async (query: string, signal?: AbortSignal): Promise<string> => {
  const cleanQuery = query.slice(0, 300)
  const failures: string[] = []

  for (const engine of SEARCH_ENGINES) {
    if (signal?.aborted) throw new Error('Search aborted by user.')
    try {
      const html = await fetchSearchHtml(engine.buildUrl(cleanQuery), signal)
      const results = engine.parse(html)
      if (results.length > 0) {
        return formatSearchResults(results)
      }
      failures.push(`${engine.name}: no results`)
    } catch (error) {
      const err = error as Error
      failures.push(`${engine.name}: ${err.message}`)
      console.warn(`Search engine "${engine.name}" failed, trying next. Error:`, err.message)
    }
  }

  throw new Error(
    `No search results from any engine for query: "${cleanQuery}". Tried — ${failures.join('; ')}`
  )
}
