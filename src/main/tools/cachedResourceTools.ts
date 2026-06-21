import { ToolArgs } from '../../shared/types'
import { readResourceChunkWindow } from '../resourceCache'
import { formatResourceOffsets, formatResourceRanges } from './resourceFormat'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const cachedResourceTools: Record<string, ToolDefinition> = {
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
        return createResourceToolResult({
          resultForModel:
            'No cached resources are attached to this conversation. Use fetch_url, file_read, or another source tool if you need new context.',
          title: 'Cached Resources',
          summary: 'No cached resources attached to this conversation'
        })
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

      return createResourceToolResult({
        resultForModel: lines.join('\n'),
        title: 'Cached Resources',
        summary: `Listed ${resources.length} cached resources`
      })
    }
  },
  read_cached_resource: {
    name: 'read_cached_resource',
    title: 'Read Cached Resource',
    description:
      'Reads the full text content of a previously fetched resource chunk using its resourceId and offset from the local cache.',
    tags: ['cache', 'resource', 'read', 'local', 'history', '缂撳瓨', '璧勬簮', '璇诲彇'],
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

      return createResourceToolResult({
        resultForModel: `Resource ID: ${resourceId}\nRequested Offset: ${chunk.requestedOffset}\nReturned Offset: ${chunk.offset}-${chunk.endOffset}${warning}\n\nContent:\n${chunk.text}`,
        title: `Read Cached Resource: ${resourceId}`,
        summary: chunk.warning
          ? `Adjusted offset ${chunk.requestedOffset} to ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
          : `Read cached chunk at offset ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
      })
    }
  }
}
