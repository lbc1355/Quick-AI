import { ChatCompletionMessage } from '../../shared/types'
import { estimateMessagesTokens } from './tokenEstimator'
import { sliceUtf8Prefix, sliceUtf8Suffix, utf8ByteLength } from './utf8Text'

export const STALE_TOOL_RESULT_COMPACT_MARKER =
  'Historical tool result compacted for cache-priority context.'
export const STALE_TOOL_RESULT_COMPACT_THRESHOLD_CHARS = 4000
export const STALE_TOOL_RESULT_COMPACT_THRESHOLD_BYTES = STALE_TOOL_RESULT_COMPACT_THRESHOLD_CHARS
const DEFAULT_PREVIEW_CHARS = 360
const DEFAULT_REOPEN_CHARS = 8000

interface ResourceReference {
  resourceId: string
  requestedOffset?: number
  returnedOffset?: string
  returnedStartOffset?: number
  returnedEndOffset?: number
  requestedMaxChars?: number
  nextOffset?: number
}

export interface CompactStaleToolResultsOptions {
  thresholdBytes?: number
  previewBytes?: number
  /** @deprecated Use thresholdBytes. */
  thresholdChars?: number
  /** @deprecated Use previewBytes. */
  previewChars?: number
}

const lineValue = (content: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))?.[1]?.trim()
}

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseReturnedOffset = (
  value: string | undefined
): Pick<ResourceReference, 'returnedOffset' | 'returnedStartOffset' | 'returnedEndOffset'> => {
  if (!value) return {}
  const match = value.match(/(\d+)\s*-\s*(\d+)/)
  if (!match) return { returnedOffset: value }
  return {
    returnedOffset: `${match[1]}-${match[2]}`,
    returnedStartOffset: Number.parseInt(match[1], 10),
    returnedEndOffset: Number.parseInt(match[2], 10)
  }
}

const parseResourceReference = (content: string): ResourceReference | undefined => {
  const resourceId = lineValue(content, 'Resource ID') || lineValue(content, 'resourceId')
  if (!resourceId) return undefined

  return {
    resourceId,
    requestedOffset: parseNumber(lineValue(content, 'Requested Offset')),
    requestedMaxChars: parseNumber(lineValue(content, 'Requested Max Chars')),
    nextOffset: parseNumber(lineValue(content, 'Next Offset')),
    ...parseReturnedOffset(lineValue(content, 'Returned Offset'))
  }
}

const modelPreviewSource = (content: string): string => {
  const markers = ['\nContent:\n', '\nHead preview:\n']
  for (const marker of markers) {
    const index = content.indexOf(marker)
    if (index >= 0) return content.slice(index + marker.length).trim()
  }
  return content.trim()
}

const previewText = (content: string, previewBytes: number): string => {
  const source = modelPreviewSource(content)
  if (utf8ByteLength(source) <= previewBytes) return source
  if (source.includes('\nTail preview:\n')) {
    const omission = '\n...\n'
    const available = Math.max(2, previewBytes - utf8ByteLength(omission))
    const head = sliceUtf8Prefix(source, Math.ceil(available / 2))
    const tail = sliceUtf8Suffix(source, Math.floor(available / 2))
    return `${head.text}${omission}${tail.text}`
  }
  return `${sliceUtf8Prefix(source, previewBytes).text}...`
}

const reopenOffset = (ref: ResourceReference): number =>
  ref.requestedOffset ?? ref.returnedStartOffset ?? 0

const reopenMaxChars = (ref: ResourceReference): number => {
  if (ref.requestedMaxChars) return ref.requestedMaxChars
  if (ref.returnedStartOffset !== undefined && ref.returnedEndOffset !== undefined) {
    return Math.max(500, Math.min(16000, ref.returnedEndOffset - ref.returnedStartOffset))
  }
  return DEFAULT_REOPEN_CHARS
}

export const isCompactedStaleToolResultContent = (content: string): boolean =>
  content.startsWith(STALE_TOOL_RESULT_COMPACT_MARKER)

export function compactStaleToolResultMessage(
  message: ChatCompletionMessage,
  options: CompactStaleToolResultsOptions = {}
): ChatCompletionMessage {
  if (message.role !== 'tool' || typeof message.content !== 'string') return message
  if (isCompactedStaleToolResultContent(message.content)) return message

  const threshold =
    options.thresholdBytes ?? options.thresholdChars ?? STALE_TOOL_RESULT_COMPACT_THRESHOLD_BYTES
  if (utf8ByteLength(message.content) <= threshold) return message

  const ref = parseResourceReference(message.content)
  if (!ref) return message

  const offset = reopenOffset(ref)
  const maxChars = reopenMaxChars(ref)
  const preview = previewText(
    message.content,
    options.previewBytes ?? options.previewChars ?? DEFAULT_PREVIEW_CHARS
  )
  const lines = [
    STALE_TOOL_RESULT_COMPACT_MARKER,
    `Tool: ${message.name || 'unknown'}`,
    message.tool_call_id ? `Tool call ID: ${message.tool_call_id}` : '',
    `Original chars: ${message.content.length}`,
    `Original UTF-8 bytes: ${utf8ByteLength(message.content)}`,
    `Resource ID: ${ref.resourceId}`,
    ref.returnedOffset ? `Original returned offset: ${ref.returnedOffset}` : '',
    ref.nextOffset !== undefined ? `Original next offset: ${ref.nextOffset}` : '',
    `To reopen: read_cached_resource {"resourceId":"${ref.resourceId}","offset":${offset},"maxChars":${maxChars}}`,
    `To search: search_cached_resource {"resourceId":"${ref.resourceId}","query":"..."}`,
    '',
    'Preview:',
    preview
  ]

  return {
    ...message,
    content: lines.filter(Boolean).join('\n')
  }
}

export const STALE_TOOL_RESULT_COMPACT_TRIGGER_RATIO = 0.8
const DEFAULT_PROTECTED_TAIL_MESSAGES = 8

export interface CompactStaleToolResultsForContextPressureOptions extends CompactStaleToolResultsOptions {
  maxTokens: number
  triggerRatio?: number
  protectedTailMessages?: number
}

export interface CompactStaleToolResultsForContextPressureResult {
  messages: ChatCompletionMessage[]
  triggered: boolean
  compactedCount: number
  savedChars: number
  beforeTokens: number
  afterTokens: number
  triggerTokens: number
}

const findLatestUserMessageIndex = (messages: ChatCompletionMessage[]): number => {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

const protectedStartIndex = (
  messages: ChatCompletionMessage[],
  protectedTailMessages: number
): number => {
  const latestUserIndex = findLatestUserMessageIndex(messages)
  if (latestUserIndex >= 0) return latestUserIndex
  return Math.max(1, messages.length - protectedTailMessages)
}

export function compactStaleToolResultsForContextPressure(
  messages: ChatCompletionMessage[],
  options: CompactStaleToolResultsForContextPressureOptions
): CompactStaleToolResultsForContextPressureResult {
  const beforeTokens = estimateMessagesTokens(messages)
  const triggerRatio = options.triggerRatio ?? STALE_TOOL_RESULT_COMPACT_TRIGGER_RATIO
  const triggerTokens = Math.floor(options.maxTokens * triggerRatio)

  if (options.maxTokens <= 0 || beforeTokens < triggerTokens) {
    return {
      messages,
      triggered: false,
      compactedCount: 0,
      savedChars: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      triggerTokens
    }
  }

  const compactBeforeIndex = protectedStartIndex(
    messages,
    options.protectedTailMessages ?? DEFAULT_PROTECTED_TAIL_MESSAGES
  )
  if (compactBeforeIndex <= 1) {
    return {
      messages,
      triggered: true,
      compactedCount: 0,
      savedChars: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      triggerTokens
    }
  }

  let compactedCount = 0
  let savedChars = 0
  const next = messages.map((message, index) => {
    if (index <= 0 || index >= compactBeforeIndex) return message
    const compacted = compactStaleToolResultMessage(message, options)
    if (
      compacted !== message &&
      typeof message.content === 'string' &&
      typeof compacted.content === 'string'
    ) {
      compactedCount++
      savedChars += Math.max(0, message.content.length - compacted.content.length)
    }
    return compacted
  })

  if (compactedCount === 0) {
    return {
      messages,
      triggered: true,
      compactedCount,
      savedChars,
      beforeTokens,
      afterTokens: beforeTokens,
      triggerTokens
    }
  }

  return {
    messages: next,
    triggered: true,
    compactedCount,
    savedChars,
    beforeTokens,
    afterTokens: estimateMessagesTokens(next),
    triggerTokens
  }
}
