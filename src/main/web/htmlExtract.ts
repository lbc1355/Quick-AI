const MAX_LINKS = 40

export interface WebLink {
  id: number
  text: string
  href: string
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

export const stripHtmlWithLinks = (
  html: string,
  baseUrl: string
): { text: string; links: WebLink[] } => {
  const links: WebLink[] = []

  let work = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

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

const removeChrome = (html: string): string => {
  let work = html
  for (const tag of CHROME_TAGS) {
    work = work.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  return work
}

const approxTextLength = (htmlFragment: string): number =>
  stripHtml(htmlFragment).replace(/\s+/g, ' ').trim().length

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
  return html.slice(start)
}

const pickDensestBlock = (html: string, tags: string[]): string | null => {
  let best: { html: string; len: number } | null = null
  for (const tag of tags) {
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

export const extractMainContentHtml = (html: string): string | null => {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  const scope = bodyMatch ? bodyMatch[1] : html
  const fullLen = approxTextLength(scope)
  if (fullLen === 0) return null

  const cleaned = removeChrome(scope)

  const semantic = pickDensestBlock(cleaned, ['main', 'article'])
  if (semantic && approxTextLength(semantic) >= Math.min(200, fullLen * 0.25)) {
    return semantic
  }

  const generic = pickDensestBlock(cleaned, ['section', 'div'])
  if (generic && approxTextLength(generic) >= 200 && approxTextLength(generic) >= fullLen * 0.4) {
    return generic
  }

  return null
}

export const renderWithLineNumbers = (text: string, startLine = 1): string => {
  const lines = text.split('\n')
  return lines.map((line, idx) => `${String(startLine + idx).padStart(5, ' ')}  ${line}`).join('\n')
}
