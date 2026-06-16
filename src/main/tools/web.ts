import { webSearchDetailed, formatSearchResultsForModel } from '../webTools'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { fetchCacheAndFormat } from './shared'
import { getCachedLink, findInResource } from '../resourceCache'
import { loadSettings } from '../database'

export const webTools: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    title: 'Fetch URL Content',
    description:
      'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
    tags: ['web', 'scraper', 'fetch', 'parse', '网页', '抓取', '读取', '爬虫', '获取'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute public URL to fetch.'
        },
        offset: {
          type: 'number',
          description:
            'Optional character offset for continuing a long page. Use nextOffset from a previous fetch_url result.'
        },
        maxChars: {
          type: 'number',
          description:
            'Optional maximum characters to return for this page window. Clamped between 1000 and 16000.'
        },
        render: {
          type: 'boolean',
          description:
            'Set true to render the page in a headless browser (executes JavaScript). Use for SPAs / dynamic pages that return little or no text with a normal fetch. Slower; only use when a plain fetch comes back near-empty.'
        }
      },
      required: ['url']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const url = args.url
      if (typeof url !== 'string' || !url) {
        throw new Error('Missing or invalid URL parameter')
      }
      const offset = typeof args.offset === 'number' ? args.offset : undefined
      const maxChars = typeof args.maxChars === 'number' ? args.maxChars : undefined
      const render = args.render === true
      return fetchCacheAndFormat(url, ctx, { offset, maxChars, render })
    }
  },
  click_link: {
    name: 'click_link',
    title: 'Click Link',
    description:
      'Follow a numbered link ([N]) from a previously fetched page. Provide the resourceId of the page and the linkId shown inline in the text. Fetches and caches the target page.',
    tags: [
      'web',
      'link',
      'click',
      'follow',
      'navigate',
      'browse',
      '链接',
      '点击',
      '跳转',
      '导航',
      '浏览'
    ],
    dependencies: ['fetch_url'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'The resourceId of the page containing the link (from a fetch_url result).'
        },
        linkId: {
          type: 'number',
          description: 'The inline link number [N] shown in the page text.'
        }
      },
      required: ['resourceId', 'linkId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const resourceId = args.resourceId
      const linkId = args.linkId
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      if (typeof linkId !== 'number' || Number.isNaN(linkId)) {
        throw new Error('Missing or invalid linkId parameter')
      }

      const link = getCachedLink(resourceId, linkId)
      if (!link) {
        return {
          resultForModel: `No link [${linkId}] found for resource ${resourceId}. The page may not have that many links, or it was not fetched with link extraction.`,
          resultForUi: {
            title: `Click Link [${linkId}]`,
            summary: 'Link not found'
          }
        }
      }

      return fetchCacheAndFormat(link.href, ctx, {})
    }
  },
  find_in_page: {
    name: 'find_in_page',
    title: 'Find In Page',
    description:
      'Search the full cached text of a previously fetched page for a query string, returning matching line numbers and lines. Like Ctrl+F. Use the resourceId from a fetch_url result.',
    tags: ['web', 'find', 'search', 'grep', 'page', 'locate', '查找', '搜索', '页内', '定位'],
    dependencies: ['fetch_url'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'The resourceId of the page to search (from a fetch_url result).'
        },
        query: {
          type: 'string',
          description: 'The text to search for within the cached page.'
        },
        maxMatches: {
          type: 'number',
          description: 'Maximum number of matching lines to return (default 15).'
        }
      },
      required: ['resourceId', 'query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const resourceId = args.resourceId
      const query = args.query
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }
      const maxMatches =
        typeof args.maxMatches === 'number' ? Math.min(50, Math.max(1, args.maxMatches)) : 15

      const matches = findInResource(resourceId, query, maxMatches)
      if (matches.length === 0) {
        return {
          resultForModel: `No matches for "${query}" in cached page ${resourceId}. The page may not be fully cached — fetch more with fetch_url offset, or refine the query.`,
          resultForUi: {
            title: `Find: "${query}"`,
            summary: 'No matches found'
          }
        }
      }

      const body = [
        `Found ${matches.length} matching line(s) for "${query}" in ${resourceId}:`,
        '',
        ...matches.map((m) => `${String(m.lineNumber).padStart(5, ' ')}  ${m.text}`)
      ].join('\n')

      return {
        resultForModel: body,
        resultForUi: {
          title: `Find: "${query}"`,
          summary: `Found ${matches.length} matching line(s)`
        }
      }
    }
  },
  web_search: {
    name: 'web_search',
    title: 'Web Search',
    description:
      'Search the web for pages matching a query. Uses a configured search API (Tavily or Brave) when available, otherwise falls back to built-in Bing/Sogou/DuckDuckGo scraping. Supports limiting result count, filtering by recency, and language hints. When an API provider returns a direct answer, it is included at the top.',
    tags: [
      'web',
      'search',
      'query',
      'bing',
      'sogou',
      'duckduckgo',
      'tavily',
      'brave',
      '搜索',
      '网页',
      '查找'
    ],
    dependencies: ['fetch_url'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search keywords or query.' },
        count: {
          type: 'number',
          description: 'Maximum number of results to return (1-20, default 8).'
        },
        freshness: {
          type: 'string',
          description:
            'Restrict results by recency. Use for time-sensitive queries (news, latest versions). Default "all".',
          enum: ['day', 'week', 'month', 'year', 'all']
        },
        lang: {
          type: 'string',
          description:
            'Preferred result language/region as a BCP-47 code, e.g. "en-US" or "zh-CN". Optional.'
        }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const query = args.query
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }

      const count = typeof args.count === 'number' ? args.count : undefined
      const freshness = typeof args.freshness === 'string' ? args.freshness : undefined
      const lang = typeof args.lang === 'string' ? args.lang : undefined

      // Resolve the configured search provider from settings (API key, provider type). Reading
      // here keeps webTools.ts free of any database dependency so it stays unit-testable.
      let config: { provider: 'auto' | 'html' | 'tavily' | 'brave'; apiKey?: string } | undefined
      try {
        const settings = loadSettings()
        if (settings.webSearch) {
          config = {
            provider: settings.webSearch.provider || 'auto',
            apiKey: settings.webSearch.apiKey
          }
        }
      } catch {
        // No settings available (e.g. in tests) — fall back to default HTML scraping.
      }

      const detailed = await webSearchDetailed(query, ctx.signal, {
        count,
        freshness: freshness as 'day' | 'week' | 'month' | 'year' | 'all' | undefined,
        lang,
        config
      })

      const formatted = formatSearchResultsForModel(detailed.results)
      const answerBlock = detailed.answer ? `Answer: ${detailed.answer}\n\n` : ''
      const resultForModel =
        `${answerBlock}${formatted}\n\n` +
        'Instruction: Pick 1 to 3 relevant URLs and call fetch_url before final answer when current page content matters.'

      return {
        resultForModel,
        resultForUi: {
          title: `Search: ${query}`,
          summary: `Found ${detailed.results.length} results via ${detailed.provider}`,
          items: detailed.results
        }
      }
    }
  }
}
