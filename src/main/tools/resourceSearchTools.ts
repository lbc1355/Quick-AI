import { ToolArgs } from '../../shared/types'
import { loadResourceCache } from '../database'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

type ResourceMatch = { offset: number; endOffset: number; snippet: string }

function collectResourceMatches(
  chunks: Array<{ text?: string | null; offset?: number | null; endOffset?: number | null }>,
  query: string
): ResourceMatch[] {
  const queryLower = query.toLowerCase()
  const matches: ResourceMatch[] = []

  for (const chunk of chunks) {
    if (!chunk.text) continue
    const textLower = chunk.text.toLowerCase()
    const idx = textLower.indexOf(queryLower)
    if (idx !== -1) {
      matches.push(createMatch(chunk, idx, query.length))
    }
  }

  if (matches.length > 0) return matches

  const words = queryLower.split(/\s+/).filter((word) => word.length > 1)
  for (const chunk of chunks) {
    if (!chunk.text) continue
    const textLower = chunk.text.toLowerCase()
    for (const word of words) {
      const idx = textLower.indexOf(word)
      if (idx !== -1) {
        matches.push(createMatch(chunk, idx, word.length))
        break
      }
    }
  }

  return matches
}

function createMatch(
  chunk: { text?: string | null; offset?: number | null; endOffset?: number | null },
  index: number,
  length: number
): ResourceMatch {
  const text = chunk.text || ''
  const matchStart = Math.max(0, index - 60)
  const matchEnd = Math.min(text.length, index + length + 90)
  let snippet = text.substring(matchStart, matchEnd)
  if (matchStart > 0) snippet = '...' + snippet
  if (matchEnd < text.length) snippet = snippet + '...'
  return {
    offset: chunk.offset || 0,
    endOffset: chunk.endOffset || 0,
    snippet
  }
}

export const resourceSearchTools: Record<string, ToolDefinition> = {
  search_cached_resource: {
    name: 'search_cached_resource',
    title: 'Search Cached Resource',
    description:
      'Searches inside a previously cached resource using a query string to find matching offsets and snippets.',
    tags: [
      'cache',
      'resource',
      'search',
      'find',
      'local',
      'history',
      '缂撳瓨',
      '璧勬簮',
      '鎼滅储',
      '鏌ユ壘'
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

      const matches = collectResourceMatches(resourceData.chunks, query)
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
        bodyLines.push(`${index + 1}. Chunk Offset: ${match.offset}-${match.endOffset}`)
        bodyLines.push(`   Snippet: "${match.snippet.replace(/\r?\n/g, ' ')}"`)
        bodyLines.push(
          `   Instruction: To read the full details, call read_cached_resource with {"resourceId":"${resourceId}","offset":${match.offset}}`
        )
        bodyLines.push('')
      })

      return createResourceToolResult({
        resultForModel: bodyLines.join('\n'),
        title: `Search Cache: "${query}"`,
        summary: `Found ${matches.length} matching offsets`
      })
    }
  }
}
