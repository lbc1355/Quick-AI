import { ToolArgs } from '../../shared/types'
import { fetchCacheAndFormat } from './shared'
import { ToolDefinition, ToolExecutionContext } from './types'

export const webFetchTool: ToolDefinition = {
  name: 'fetch_url',
  title: 'Fetch URL Content',
  description:
    'Fetches a public HTTP or HTTPS HTML/text web page and returns its title, text content, and extracted links. Use pdf_read for PDF URLs or arXiv abstract URLs when PDF full text is needed.',
  tags: ['web', 'scraper', 'fetch', 'parse', '缃戦〉', '鎶撳彇', '璇诲彇', '鐖櫕', '鑾峰彇'],
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
}
