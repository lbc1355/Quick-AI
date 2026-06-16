import { lookup } from 'dns/promises'

export interface WebLink {
  id: number
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
const MAX_LINKS = 40
const DEFAULT_FETCH_PAGE_CHARS = 10000
const MAX_FETCH_PAGE_CHARS = 16000

export interface FetchUrlOptions {
  offset?: number
  maxChars?: number
  /** Force JS rendering via the injected headless renderer (when available). */
  render?: boolean
}

// ── JS-rendering seam ────────────────────────────────────────────────────────
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

export const normalizeFetchUrlOptions = (
  options: FetchUrlOptions = {}
): { offset: number; maxChars: number } => {
  const rawOffset = typeof options.offset === 'number' ? options.offset : 0
  const rawMaxChars =
    typeof options.maxChars === 'number' ? options.maxChars : DEFAULT_FETCH_PAGE_CHARS

  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
  const maxChars = Number.isFinite(rawMaxChars)
    ? Math.min(MAX_FETCH_PAGE_CHARS, Math.max(1000, Math.floor(rawMaxChars)))
    : DEFAULT_FETCH_PAGE_CHARS

  return { offset, maxChars }
}

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

  // arXiv: /pdf/XXXX.XXXX → /abs/XXXX.XXXX
  if (
    (parsed.hostname === 'arxiv.org' || parsed.hostname.endsWith('.arxiv.org')) &&
    parsed.pathname.startsWith('/pdf/')
  ) {
    const id = parsed.pathname.replace(/^\/pdf\//, '')
    const newUrl = `https://arxiv.org/abs/${id}`
    console.log(`[fetch_url] Rewriting arXiv PDF URL → abstract page: ${rawUrl} → ${newUrl}`)
    return newUrl
  }

  return rawUrl
}

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

// Strip HTML to text while inlining anchors as "[N] text" markers and collecting a
// numbered link table. Block tags become newlines so document structure is preserved.
// This lets the model later "click" a link by its id (see click_link tool).
export const stripHtmlWithLinks = (
  html: string,
  baseUrl: string
): { text: string; links: WebLink[] } => {
  const links: WebLink[] = []

  // 1. Remove non-content blocks first (content included)
  let work = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  // 2. Replace anchors with "[N] text" markers, collecting the link table
  work = work.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const hrefMatch = attrs.match(/\shref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const rawHref = hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || ''
    const text = stripHtml(inner).replace(/\s+/g, ' ').trim()

    if (!rawHref || rawHref.startsWith('#')) {
      return text || full
    }

    try {
      const href = new URL(decodeHtmlEntities(rawHref), baseUrl)
      if (href.protocol !== 'http:' && href.protocol !== 'https:') {
        return text
      }
      if (links.length >= MAX_LINKS) {
        return text
      }
      const id = links.length + 1
      const linkText = text || href.hostname
      links.push({ id, text: linkText.slice(0, 160), href: href.toString() })
      return `[${id}] ${linkText}`
    } catch {
      return text
    }
  })

  // 3. Block tags → newlines, strip remaining tags, decode + normalize
  const text = decodeHtmlEntities(
    work
      .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  ).trim()

  return { text, links }
}

// ── Readability-lite main-content extraction ─────────────────────────────────
// A lightweight, dependency-free heuristic that isolates the primary article/content region
// before link-aware HTML stripping. It removes chrome (nav/header/footer/aside/forms/etc.),
// then prefers an explicit <main>/<article> region, falling back to the highest-text-density
// <div>/<section> block. If extraction yields too little text relative to the full page it
// returns null so the caller can fall back to whole-page stripping (avoids over-pruning).

const CHROME_TAGS = [
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'figure',
  'figcaption',
  'menu',
  'dialog'
]

// Strip obvious non-content chrome elements (by tag) from an HTML fragment.
const removeChrome = (html: string): string => {
  let work = html
  for (const tag of CHROME_TAGS) {
    work = work.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  return work
}

// Rough text length of an HTML fragment after tags are removed — used to score candidate blocks.
const approxTextLength = (htmlFragment: string): number =>
  stripHtml(htmlFragment).replace(/\s+/g, ' ').trim().length

// Pull the inner HTML of the first occurrence of a block tag (handles one level of same-tag
// nesting well enough for typical article/main containers).
const extractFirstBlock = (html: string, tag: string): string | null => {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'i')
  const openMatch = openRe.exec(html)
  if (!openMatch) return null
  const start = openMatch.index + openMatch[0].length
  const lowerTag = tag.toLowerCase()
  const tokenRe = new RegExp(`<(/?)${lowerTag}\\b[^>]*>`, 'gi')
  tokenRe.lastIndex = start
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    if (m[1] === '/') {
      depth--
      if (depth === 0) return html.slice(start, m.index)
    } else {
      depth++
    }
  }
  return html.slice(start) // unbalanced markup: take the rest
}

// Choose the densest block among the candidate container tags.
const pickDensestBlock = (html: string, tags: string[]): string | null => {
  let best: { html: string; len: number } | null = null
  for (const tag of tags) {
    // Scan all occurrences of this tag.
    const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(html))) {
      const block = extractFirstBlock(html.slice(match.index), tag)
      if (!block) continue
      const len = approxTextLength(block)
      if (!best || len > best.len) best = { html: block, len }
    }
  }
  return best && best.len > 0 ? best.html : null
}

/**
 * Extract the main content HTML fragment from a full HTML document. Returns null when no
 * confident main region is found (caller should then strip the whole page).
 */
export const extractMainContentHtml = (html: string): string | null => {
  // Work on the <body> if present to skip head metadata.
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  const scope = bodyMatch ? bodyMatch[1] : html
  const fullLen = approxTextLength(scope)
  if (fullLen === 0) return null

  const cleaned = removeChrome(scope)

  // 1. Prefer semantic containers.
  const semantic = pickDensestBlock(cleaned, ['main', 'article'])
  if (semantic && approxTextLength(semantic) >= Math.min(200, fullLen * 0.25)) {
    return semantic
  }

  // 2. Fall back to the densest generic block (require a meaningful absolute amount of text so
  // trivially short pages don't get "extracted" into a tiny div).
  const generic = pickDensestBlock(cleaned, ['section', 'div'])
  if (generic && approxTextLength(generic) >= 200 && approxTextLength(generic) >= fullLen * 0.4) {
    return generic
  }

  return null
}

// Prefix each line with a right-aligned line number, starting at startLine (1-indexed).
export const renderWithLineNumbers = (text: string, startLine = 1): string => {
  const lines = text.split('\n')
  return lines.map((line, idx) => `${String(startLine + idx).padStart(5, ' ')}  ${line}`).join('\n')
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source?: 'Bing' | 'Sogou' | 'DuckDuckGo' | 'Tavily' | 'Brave'
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


export const parseDuckDuckGoResults = (html: string, limit = 8): WebSearchResult[] => {
  const results: WebSearchResult[] = []
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

    results.push({ title, url: href, snippet, source: 'DuckDuckGo' })
  }
  return results
}

export const parseBingResults = (html: string, limit = 8): WebSearchResult[] => {
  const results: WebSearchResult[] = []
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
      results.push({ title, url: href, snippet, source: 'Bing' })
    }
  }
  return results
}

export const parseSogouResults = (html: string, limit = 8): WebSearchResult[] => {
  const results: WebSearchResult[] = []
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
      results.push({ title, url: href, snippet, source: 'Sogou' })
    }
  }
  return results
}

export const formatSearchResultsForModel = (results: WebSearchResult[]): string =>
  results
    .map((r, idx) => `${idx + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`)
    .join('\n\n')

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
        console.warn('[fetch_url] JS-render fallback failed; using static HTML.', (err as Error).message)
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

// ── Search providers ────────────────────────────────────────────────────────
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
      `No search results from any HTML engine for query: "${query}". Tried — ${failures.join('; ')}`
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

// ── Search result cache ──────────────────────────────────────────────────────
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
