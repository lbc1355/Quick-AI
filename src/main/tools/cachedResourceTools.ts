import { ToolArgs } from '../../shared/types'
import { readResourceChunkWindow } from '../resourceCache'
import { formatResourceOffsets, formatResourceRanges } from './resourceFormat'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

const MIN_READ_CACHED_RESOURCE_CHARS = 500
const MAX_READ_CACHED_RESOURCE_CHARS = 16000

interface CachedResourceReadWindow {
  text: string
  offset: number
  endOffset: number
  nextOffset?: number
  maxChars?: number
  warning?: string
}

const normalizeMaxChars = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid maxChars parameter')
  }
  return Math.min(
    MAX_READ_CACHED_RESOURCE_CHARS,
    Math.max(MIN_READ_CACHED_RESOURCE_CHARS, Math.floor(value))
  )
}

export const projectCachedResourceReadWindow = (
  chunk: Awaited<ReturnType<typeof readResourceChunkWindow>>,
  maxChars?: number
): CachedResourceReadWindow => {
  const requestedOffset = chunk.requestedOffset
  const startsInsideChunk = requestedOffset >= chunk.offset && requestedOffset < chunk.endOffset
  const startOffset = maxChars !== undefined && startsInsideChunk ? requestedOffset : chunk.offset
  const startIndex = Math.max(0, startOffset - chunk.offset)
  let text = chunk.text.slice(startIndex)
  let endOffset = startOffset + text.length
  let nextOffset: number | undefined
  const warnings = chunk.warning ? [chunk.warning] : []

  if (maxChars !== undefined && text.length > maxChars) {
    text = text.slice(0, maxChars)
    endOffset = startOffset + text.length
    nextOffset = endOffset
    warnings.push(
      `Returned ${text.length} characters due to maxChars=${maxChars}. More cached text is available at offset ${nextOffset}.`
    )
  }

  return {
    text,
    offset: startOffset,
    endOffset,
    nextOffset,
    maxChars,
    warning: warnings.join(' ')
  }
}

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
    tags: ['cache', 'resource', 'read', 'local', 'history', 'window', 'offset'],
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
        },
        maxChars: {
          type: 'number',
          description:
            'Optional maximum characters to return from the cached chunk. Clamped between 500 and 16000. If omitted, the full cached chunk is returned.'
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
      const maxChars = normalizeMaxChars(args.maxChars)
      const window = projectCachedResourceReadWindow(chunk, maxChars)
      const warning = window.warning ? `\nWarning: ${window.warning}` : ''
      const maxCharsLine = maxChars !== undefined ? `\nRequested Max Chars: ${maxChars}` : ''
      const nextOffsetLine =
        window.nextOffset !== undefined ? `\nNext Offset: ${window.nextOffset}` : ''

      return createResourceToolResult({
        resultForModel: `Resource ID: ${resourceId}\nRequested Offset: ${chunk.requestedOffset}${maxCharsLine}\nReturned Offset: ${window.offset}-${window.endOffset}${nextOffsetLine}${warning}\n\nContent:\n${window.text}`,
        title: `Read Cached Resource: ${resourceId}`,
        summary: window.warning
          ? `Adjusted offset ${chunk.requestedOffset} to ${window.offset}-${window.endOffset} (${window.text.length} characters)`
          : `Read cached chunk at offset ${window.offset}-${window.endOffset} (${window.text.length} characters)`
      })
    }
  }
}
