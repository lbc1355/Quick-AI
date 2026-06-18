import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { loadResourceCache } from '../database'
import { readResourceChunkWindow } from '../resourceCache'
import { ToolDefinition, ToolExecutionContext } from './types'

function formatResourceRanges(ranges: Array<{ start: number; end: number }> | undefined): string {
  if (!ranges || ranges.length === 0) return ''
  return ranges
    .slice(0, 6)
    .map((range) => `${range.start}-${range.end}`)
    .join(', ')
}

function formatResourceOffsets(
  chunks: NonNullable<ToolExecutionContext['resources']>[number]['chunks']
): string {
  const offsets = chunks
    .map((chunk) =>
      chunk.offset !== undefined && chunk.endOffset !== undefined
        ? `${chunk.offset}-${chunk.endOffset}`
        : undefined
    )
    .filter((value): value is string => Boolean(value))

  if (offsets.length === 0) return ''
  const preview = offsets.slice(0, 8).join(', ')
  return offsets.length > 8 ? `${preview}, +${offsets.length - 8} more` : preview
}

export const resourceTools: Record<string, ToolDefinition> = {
  list_cached_resources: {
    name: 'list_cached_resources',
    title: 'List Cached Resources',
    description:
      'Lists cached resources available in the current conversation, including resource IDs and cached offsets. Use this before read_cached_resource or search_cached_resource when you need prior fetched files, web pages, or documents.',
    tags: ['cache', 'resource', 'list', 'history', 'local', 'cached'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (_args: ToolArgs, ctx: ToolExecutionContext) => {
      const resources = [...(ctx.resources || [])].sort((a, b) => b.updatedAt - a.updatedAt)

      if (resources.length === 0) {
        return {
          resultForModel:
            'No cached resources are attached to this conversation. Use fetch_url, file_read, or another source tool if you need new context.',
          resultForUi: {
            title: 'Cached Resources',
            summary: 'No cached resources attached to this conversation'
          }
        }
      }

      const lines = [`Cached resources attached to this conversation (${resources.length}):`, '']

      resources.slice(0, 50).forEach((resource, index) => {
        const ranges = formatResourceRanges(resource.fetchedRanges)
        const offsets = formatResourceOffsets(resource.chunks || [])
        lines.push(`${index + 1}. ${resource.title || 'Untitled'}`)
        lines.push(`   resourceId: ${resource.id}`)
        lines.push(`   kind: ${resource.kind}`)
        lines.push(`   source: ${resource.source}`)
        lines.push(`   status: ${resource.status}`)
        if (resource.totalChars !== undefined) lines.push(`   totalChars: ${resource.totalChars}`)
        if (ranges) lines.push(`   cachedRanges: ${ranges}`)
        if (offsets) lines.push(`   readableOffsets: ${offsets}`)
        if (resource.nextOffset !== undefined) lines.push(`   nextOffset: ${resource.nextOffset}`)
        if (resource.summary) lines.push(`   summary: ${resource.summary}`)
        lines.push(
          `   To read: read_cached_resource {"resourceId":"${resource.id}","offset":${resource.chunks?.[0]?.offset ?? 0}}`
        )
        lines.push('')
      })

      if (resources.length > 50) {
        lines.push(`${resources.length - 50} additional resources omitted from this listing.`)
      }

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'Cached Resources',
          summary: `Listed ${resources.length} cached resources`
        }
      }
    }
  },
  read_cached_resource: {
    name: 'read_cached_resource',
    title: 'Read Cached Resource',
    description:
      'Reads the full text content of a previously fetched resource chunk using its resourceId and offset from the local cache.',
    tags: ['cache', 'resource', 'read', 'local', 'history', '缓存', '资源', '读取'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description:
            'The unique ID of the cached resource. Use list_cached_resources to discover IDs.'
        },
        offset: {
          type: 'number',
          description:
            'The starting character offset of the chunk to read. Use list_cached_resources to discover readable offsets.'
        }
      },
      required: ['resourceId', 'offset']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const resourceId = args.resourceId
      const offset = args.offset
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      if (typeof offset !== 'number' || !Number.isFinite(offset)) {
        throw new Error('Missing or invalid offset parameter')
      }

      console.log(
        `[read_cached_resource] Reading cached resource ${resourceId} at offset ${offset}`
      )
      const chunk = await readResourceChunkWindow(resourceId, offset)
      const warning = chunk.warning ? `\nWarning: ${chunk.warning}` : ''

      return {
        resultForModel: `Resource ID: ${resourceId}\nRequested Offset: ${chunk.requestedOffset}\nReturned Offset: ${chunk.offset}-${chunk.endOffset}${warning}\n\nContent:\n${chunk.text}`,
        resultForUi: {
          title: `Read Cached Resource: ${resourceId}`,
          summary: chunk.warning
            ? `Adjusted offset ${chunk.requestedOffset} to ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
            : `Read cached chunk at offset ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
        }
      }
    }
  },
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

      const queryLower = query.toLowerCase()
      const matches: Array<{ offset: number; endOffset: number; snippet: string }> = []

      for (const chunk of resourceData.chunks) {
        if (!chunk.text) continue
        const textLower = chunk.text.toLowerCase()
        const idx = textLower.indexOf(queryLower)
        if (idx !== -1) {
          const matchStart = Math.max(0, idx - 60)
          const matchEnd = Math.min(chunk.text.length, idx + query.length + 90)
          let snippet = chunk.text.substring(matchStart, matchEnd)
          if (matchStart > 0) snippet = '...' + snippet
          if (matchEnd < chunk.text.length) snippet = snippet + '...'
          matches.push({
            offset: chunk.offset || 0,
            endOffset: chunk.endOffset || 0,
            snippet
          })
        }
      }

      if (matches.length === 0) {
        const words = queryLower.split(/\s+/).filter((word) => word.length > 1)
        for (const chunk of resourceData.chunks) {
          if (!chunk.text) continue
          const textLower = chunk.text.toLowerCase()
          for (const word of words) {
            const idx = textLower.indexOf(word)
            if (idx !== -1) {
              const matchStart = Math.max(0, idx - 60)
              const matchEnd = Math.min(chunk.text.length, idx + word.length + 90)
              let snippet = chunk.text.substring(matchStart, matchEnd)
              if (matchStart > 0) snippet = '...' + snippet
              if (matchEnd < chunk.text.length) snippet = snippet + '...'
              matches.push({
                offset: chunk.offset || 0,
                endOffset: chunk.endOffset || 0,
                snippet
              })
              break
            }
          }
        }
      }

      if (matches.length === 0) {
        return {
          resultForModel: `No matches found for query "${query}" in cached resource ${resourceId}.`,
          resultForUi: {
            title: `Search Cache: ${query}`,
            summary: `No matches found`
          }
        }
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

      return {
        resultForModel: bodyLines.join('\n'),
        resultForUi: {
          title: `Search Cache: "${query}"`,
          summary: `Found ${matches.length} matching offsets`
        }
      }
    }
  },
  read_tool_output: {
    name: 'read_tool_output',
    title: 'Read Truncated Tool Output',
    description:
      'Retrieve the full text of an earlier tool result that was truncated to fit the context window. Use the output_id shown in the truncation marker; page through long output with offset.',
    tags: [
      'tool',
      'output',
      'truncated',
      'retrieve',
      'read',
      'history',
      '工具',
      '输出',
      '截断',
      '读取'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        output_id: {
          type: 'string',
          description: 'The id from the truncation marker (the originating tool call id).'
        },
        offset: {
          type: 'number',
          description: 'Starting character offset to read from. Defaults to 0.'
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to return in this window (1000-16000). Defaults to 8000.'
        }
      },
      required: ['output_id']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const outputId = typeof args.output_id === 'string' ? args.output_id : ''
      if (!outputId) {
        throw new Error('Missing or invalid output_id parameter')
      }

      const run = getRun(ctx.reqId)
      const full = run?.getToolOutput(outputId)
      if (full === undefined) {
        return {
          resultForModel: `No stored tool output found for output_id "${outputId}". It may have expired or never been preserved.`,
          resultForUi: {
            title: `Read Tool Output: ${outputId}`,
            summary: 'No stored output found'
          }
        }
      }

      const rawOffset =
        typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0
      const offset = Math.max(0, Math.min(Math.floor(rawOffset), full.length))
      const rawMax =
        typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) ? args.maxChars : 8000
      const maxChars = Math.min(16000, Math.max(1000, Math.floor(rawMax)))

      const slice = full.slice(offset, offset + maxChars)
      const endOffset = offset + slice.length
      const nextOffset = endOffset < full.length ? endOffset : undefined

      const header = `Tool output ${outputId} (chars ${offset}-${endOffset} of ${full.length})${
        nextOffset !== undefined ? `\nMore available: call again with offset=${nextOffset}.` : ''
      }`

      return {
        resultForModel: `${header}\n\nContent:\n${slice}`,
        resultForUi: {
          title: `Read Tool Output: ${outputId}`,
          summary: `Returned chars ${offset}-${endOffset} of ${full.length}`
        }
      }
    }
  }
}
