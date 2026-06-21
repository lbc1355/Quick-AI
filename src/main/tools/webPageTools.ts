import { ToolArgs } from '../../shared/types'
import { findInResource, getCachedLink } from '../resourceCache'
import { createToolResult } from './result'
import { fetchCacheAndFormat } from './shared'
import { ToolDefinition, ToolExecutionContext } from './types'

export const webPageTools: Record<'click_link' | 'find_in_page', ToolDefinition> = {
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
      '閾炬帴',
      '鐐瑰嚮',
      '璺宠浆',
      '瀵艰埅',
      '娴忚'
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
        return createToolResult({
          resultForModel: `No link [${linkId}] found for resource ${resourceId}. The page may not have that many links, or it was not fetched with link extraction.`,
          title: `Click Link [${linkId}]`,
          summary: 'Link not found'
        })
      }

      return fetchCacheAndFormat(link.href, ctx, {})
    }
  },
  find_in_page: {
    name: 'find_in_page',
    title: 'Find In Page',
    description:
      'Search the full cached text of a previously fetched page for a query string, returning matching line numbers and lines. Like Ctrl+F. Use the resourceId from a fetch_url result.',
    tags: [
      'web',
      'find',
      'search',
      'grep',
      'page',
      'locate',
      '鏌ユ壘',
      '鎼滅储',
      '椤靛唴',
      '瀹氫綅'
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
        return createToolResult({
          resultForModel: `No matches for "${query}" in cached page ${resourceId}. The page may not be fully cached - fetch more with fetch_url offset, or refine the query.`,
          title: `Find: "${query}"`,
          summary: 'No matches found'
        })
      }

      const body = [
        `Found ${matches.length} matching line(s) for "${query}" in ${resourceId}:`,
        '',
        ...matches.map((m) => `${String(m.lineNumber).padStart(5, ' ')}  ${m.text}`)
      ].join('\n')

      return createToolResult({
        resultForModel: body,
        title: `Find: "${query}"`,
        summary: `Found ${matches.length} matching line(s)`
      })
    }
  }
}
