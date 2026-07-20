import { ToolArgs } from '../../shared/types'
import { readResourceChunkWindow, readResourceFullText } from '../resourceCache'
import { formatResourceOffsets, formatResourceRanges } from './resourceFormat'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

const MIN_READ_CACHED_RESOURCE_CHARS = 500
const MAX_READ_CACHED_RESOURCE_CHARS = 16000
const DEFAULT_RESOURCE_LINE_WINDOW = 200
const MAX_RESOURCE_LINE_WINDOW = 1000

interface CachedResourceReadWindow {
  text: string
  offset: number
  endOffset: number
  nextOffset?: number
  maxChars?: number
  warning?: string
}

export interface CachedResourceLineWindow {
  text: string
  lineStart: number
  lineEnd: number
  totalLines: number
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

export const projectCachedResourceLineWindow = (
  content: string,
  options: { lineStart?: number; lineEnd?: number; tailLines?: number; maxChars?: number }
): CachedResourceLineWindow => {
  const lines = content ? content.split(/\r?\n/) : []
  const totalLines = lines.length
  if (totalLines === 0) return { text: '', lineStart: 0, lineEnd: 0, totalLines: 0 }

  const warnings: string[] = []
  let lineStart: number
  let requestedEnd: number
  if (options.tailLines !== undefined) {
    const tailLines = Math.min(MAX_RESOURCE_LINE_WINDOW, Math.max(1, Math.floor(options.tailLines)))
    lineStart = Math.max(1, totalLines - tailLines + 1)
    requestedEnd = totalLines
  } else {
    const requestedStart = Math.max(1, Math.floor(options.lineStart || 1))
    lineStart = Math.min(requestedStart, totalLines)
    if (requestedStart > totalLines) {
      warnings.push(`lineStart ${requestedStart} exceeds ${totalLines}; returned the last line.`)
    }
    const defaultEnd = lineStart + DEFAULT_RESOURCE_LINE_WINDOW - 1
    requestedEnd = Math.max(lineStart, Math.floor(options.lineEnd || defaultEnd))
    requestedEnd = Math.min(requestedEnd, lineStart + MAX_RESOURCE_LINE_WINDOW - 1)
    requestedEnd = Math.min(requestedEnd, totalLines)
  }

  const maxChars = options.maxChars || MAX_READ_CACHED_RESOURCE_CHARS
  const output: string[] = []
  let outputChars = 0
  let lineEnd = lineStart - 1
  for (let lineNumber = lineStart; lineNumber <= requestedEnd; lineNumber++) {
    const formatted = `${String(lineNumber).padStart(6, ' ')}  ${lines[lineNumber - 1]}`
    const separatorChars = output.length > 0 ? 1 : 0
    if (outputChars + separatorChars + formatted.length > maxChars) {
      if (output.length === 0) {
        output.push(formatted.slice(0, maxChars))
        lineEnd = lineNumber
      }
      warnings.push(`Output was limited to ${maxChars} characters.`)
      break
    }
    output.push(formatted)
    outputChars += separatorChars + formatted.length
    lineEnd = lineNumber
  }

  if (lineEnd < requestedEnd) {
    warnings.push(`More cached lines are available from line ${lineEnd + 1}.`)
  }
  return {
    text: output.join('\n'),
    lineStart,
    lineEnd,
    totalLines,
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {})
  }
}

export const cachedResourceTools: Record<string, ToolDefinition> = {
  list_cached_resources: {
    name: 'list_cached_resources',
    title: 'List Cached Resources',
    description:
      'Lists cached resources available in the current conversation, including resource IDs and cached offsets. Use this before reading or searching prior files, pages, documents, or terminal output.',
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
        if (resource.kind === 'terminal') {
          lines.push(
            `   To read tail: read_cached_resource {"resourceId":"${resource.id}","tailLines":100}`
          )
        }
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
      'Reads cached content by character offset, an inclusive line range, or a requested number of tail lines. Works for files, fetched pages, documents, and terminal output.',
    tags: ['cache', 'resource', 'read', 'local', 'history', 'window', 'offset', 'line', 'tail'],
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
            'Optional starting character offset. Defaults to 0 when no line parameters are supplied.'
        },
        lineStart: {
          type: 'number',
          description: 'Optional 1-based first line to read.'
        },
        lineEnd: {
          type: 'number',
          description: 'Optional inclusive last line to read. Maximum 1000 lines per call.'
        },
        tailLines: {
          type: 'number',
          description:
            'Optional number of lines to read from the end, up to 1000. Cannot be combined with lineStart or lineEnd.'
        },
        maxChars: {
          type: 'number',
          description:
            'Optional maximum characters to return from the cached chunk. Clamped between 500 and 16000. If omitted, the full cached chunk is returned.'
        }
      },
      required: ['resourceId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const resourceId = args.resourceId
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      const maxChars = normalizeMaxChars(args.maxChars)
      const hasLineRange = args.lineStart !== undefined || args.lineEnd !== undefined
      const hasTail = args.tailLines !== undefined
      if (hasLineRange && hasTail) {
        throw new Error('tailLines cannot be combined with lineStart or lineEnd')
      }
      if (hasLineRange || hasTail) {
        const lineStart = args.lineStart
        const lineEnd = args.lineEnd
        const tailLines = args.tailLines
        for (const [name, value] of [
          ['lineStart', lineStart],
          ['lineEnd', lineEnd],
          ['tailLines', tailLines]
        ] as const) {
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
            throw new Error(`Invalid ${name} parameter`)
          }
        }
        const window = projectCachedResourceLineWindow(readResourceFullText(resourceId), {
          ...(typeof lineStart === 'number' ? { lineStart } : {}),
          ...(typeof lineEnd === 'number' ? { lineEnd } : {}),
          ...(typeof tailLines === 'number' ? { tailLines } : {}),
          ...(maxChars !== undefined ? { maxChars } : {})
        })
        const warning = window.warning ? `\nWarning: ${window.warning}` : ''
        return createResourceToolResult({
          resultForModel: `Resource ID: ${resourceId}\nTotal Lines: ${window.totalLines}\nReturned Lines: ${window.lineStart}-${window.lineEnd}${warning}\n\nContent (line-numbered):\n${window.text || '(empty resource)'}`,
          title: `Read Cached Resource Lines: ${resourceId}`,
          summary: `Read lines ${window.lineStart}-${window.lineEnd} of ${window.totalLines}`
        })
      }

      const offset = args.offset ?? 0
      if (typeof offset !== 'number' || !Number.isFinite(offset)) {
        throw new Error('Invalid offset parameter')
      }

      console.log(
        `[read_cached_resource] Reading cached resource ${resourceId} at offset ${offset}`
      )
      const chunk = await readResourceChunkWindow(resourceId, offset)
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
