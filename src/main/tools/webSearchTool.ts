import { ToolArgs } from '../../shared/types'
import { loadSettings } from '../database'
import { formatSearchResultsForModel, webSearchDetailed } from '../webTools'
import { createToolResult } from './result'
import { ToolDefinition, ToolExecutionContext } from './types'

type WebSearchProviderConfig = {
  provider: 'auto' | 'html' | 'tavily' | 'brave'
  apiKey?: string
}

function loadWebSearchConfig(): WebSearchProviderConfig | undefined {
  try {
    const settings = loadSettings()
    if (!settings.webSearch) return undefined
    return {
      provider: settings.webSearch.provider || 'auto',
      apiKey: settings.webSearch.apiKey
    }
  } catch {
    return undefined
  }
}

export const webSearchTool: ToolDefinition = {
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
    '鎼滅储',
    '缃戦〉',
    '鏌ユ壘'
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

    const detailed = await webSearchDetailed(query, ctx.signal, {
      count,
      freshness: freshness as 'day' | 'week' | 'month' | 'year' | 'all' | undefined,
      lang,
      config: loadWebSearchConfig()
    })

    const formatted = formatSearchResultsForModel(detailed.results)
    const answerBlock = detailed.answer ? `Answer: ${detailed.answer}\n\n` : ''
    const resultForModel =
      `${answerBlock}${formatted}\n\n` +
      'Instruction: Pick 1 to 3 relevant URLs and call fetch_url before final answer when current page content matters.'

    return createToolResult({
      resultForModel,
      title: `Search: ${query}`,
      summary: `Found ${detailed.results.length} results via ${detailed.provider}`,
      items: detailed.results
    })
  }
}
