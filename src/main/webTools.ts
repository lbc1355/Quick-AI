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

const isPrivateIPv4 = (address: string): boolean => {
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

const isPrivateIPv6 = (address: string): boolean => {
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
  redirects = 0
): Promise<Response> => {
  const parsed = await validatePublicHttpUrl(rawUrl)
  const response = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'QuickAI/1.0 (+https://quickai.local)'
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
    return fetchWithCheckedRedirects(nextUrl, signal, redirects + 1)
  }

  return response
}

const readLimitedText = async (response: Response): Promise<{ text: string; truncated: boolean }> => {
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
    text: chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode(),
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

const stripHtml = (html: string): string => {
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

export const fetchUrl = async (rawUrl: string): Promise<FetchUrlResult> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchWithCheckedRedirects(rawUrl, controller.signal)
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
    }

    const finalUrl = response.url || rawUrl
    await validatePublicHttpUrl(finalUrl)
    const { text: rawText, truncated } = await readLimitedText(response)
    const contentType = response.headers.get('content-type') || ''
    const isHtml = contentType.includes('html') || /<html[\s>]/i.test(rawText)
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
  } finally {
    clearTimeout(timeoutId)
  }
}
