import { stripHtml } from './htmlExtract'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source?: 'Bing' | 'Sogou' | 'DuckDuckGo' | 'Tavily' | 'Brave'
}

export const parseDuckDuckGoResults = (html: string, limit = 8): WebSearchResult[] => {
  const results: WebSearchResult[] = []
  const blocks = html.split(/<div\s+class="[^"]*web-result[^"]*"/i)
  for (let i = 1; i < blocks.length && results.length < limit; i++) {
    const block = blocks[i]

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
