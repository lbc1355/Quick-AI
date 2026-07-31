import { ToolArgs } from '../../shared/types'
import { loadResourceCache } from '../database'
import { findInResource } from '../resourceCache'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const resourceSearchTools: Record<string, ToolDefinition> = {
  search_cached_resource: {
    name: 'search_cached_resource',
    title: 'Search Cached Resource',
    description:
      'Searches every cached line of a resource and returns matching line numbers. Works for files, pages, documents, and terminal output.',
    tags: [
      'cache',
      'resource',
      'search',
      'find',
      'local',
      'history',
      '缓存',
      '资源',
      '搜索',
      '查找'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'The unique ID of the cached resource.'
        },
        query: {
          type: 'string',
          description: 'The search query or keywords to locate inside the resource text.'
        },
        maxMatches: {
          type: 'number',
          description: 'Optional maximum matches to return, from 1 to 50. Defaults to 15.'
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

      const resourceData = loadResourceCache(resourceId)
      if (!resourceData) {
        throw new Error(`Resource cache not found for ID: ${resourceId}`)
      }

      const maxMatches =
        typeof args.maxMatches === 'number'
          ? Math.min(50, Math.max(1, Math.floor(args.maxMatches)))
          : 15
      const matches = findInResource(resourceId, query, maxMatches)
      if (matches.length === 0) {
        return createResourceToolResult({
          resultForModel: `No matches found for query "${query}" in cached resource ${resourceId}.`,
          title: `Search Cache: ${query}`,
          summary: 'No matches found'
        })
      }

      const bodyLines = [
        `Search results for query "${query}" in cached resource ${resourceId}:`,
        ''
      ]
      matches.forEach((match, index) => {
        bodyLines.push(`${index + 1}. Line ${match.lineNumber}: ${match.text.slice(0, 500)}`)
        bodyLines.push(
          `   To inspect nearby lines: read_cached_resource {"resourceId":"${resourceId}","lineStart":${Math.max(1, match.lineNumber - 5)},"lineEnd":${match.lineNumber + 5}}`
        )
        bodyLines.push('')
      })

      return createResourceToolResult({
        resultForModel: bodyLines.join('\n'),
        title: `Search Cache: "${query}"`,
        summary: `Found ${matches.length} matching lines`
      })
    }
  }
}
