import { CachePriorityRetainedRunRef, ChatCompletionMessage } from '../../shared/types'
import { RunCheckpoint, loadRunCheckpoint as defaultLoadRunCheckpoint } from './runCheckpoint'

export interface InsertCachePriorityToolContextOptions {
  sessionId: string
  retainedRuns?: CachePriorityRetainedRunRef[]
  loadRunCheckpoint?: typeof defaultLoadRunCheckpoint
}

const cloneMessages = (messages: ChatCompletionMessage[]): ChatCompletionMessage[] =>
  JSON.parse(JSON.stringify(messages)) as ChatCompletionMessage[]

const resolveInsertionIndex = (
  messages: ChatCompletionMessage[],
  requestedIndex: number
): number | undefined => {
  if (messages[requestedIndex]?.role === 'assistant') return requestedIndex

  // Older renderer builds counted assistant indexes from the visible dialogue history while the
  // main-process payload already included a leading system message. In that case the retained
  // assistant is shifted by one; accept the adjacent assistant instead of silently dropping the
  // native tool context.
  if (messages[0]?.role === 'system' && messages[requestedIndex + 1]?.role === 'assistant') {
    return requestedIndex + 1
  }

  return undefined
}

const VISUAL_ATTACHMENT_USER_PREFIX = 'Visual context from image_read:'

const getMessageTextPrefix = (content: ChatCompletionMessage['content']): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const textPart = content.find((part) => part.type === 'text')
  return typeof textPart?.text === 'string' ? textPart.text : ''
}

const isSyntheticVisualAttachmentUserMessage = (message: ChatCompletionMessage): boolean =>
  message.role === 'user' &&
  getMessageTextPrefix(message.content).startsWith(VISUAL_ATTACHMENT_USER_PREFIX)

const findCurrentRunToolContextStartIndex = (messages: ChatCompletionMessage[]): number => {
  // Checkpoints can already contain retained tool context from older runs. Only extract the
  // native tool calls produced after the latest real user turn, otherwise retained contexts are
  // recursively reinserted and grow the next request suffix.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user' && !isSyntheticVisualAttachmentUserMessage(message)) {
      return index + 1
    }
  }
  return 0
}
export function extractNativeToolContextMessages(
  checkpoint: RunCheckpoint
): ChatCompletionMessage[] {
  const extracted: ChatCompletionMessage[] = []
  const messages = checkpoint.messages || []
  const startIndex = findCurrentRunToolContextStartIndex(messages)

  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.tool_calls || message.tool_calls.length === 0) {
      continue
    }

    extracted.push(message)
    let j = i + 1
    while (j < messages.length && messages[j].role === 'tool') {
      extracted.push(messages[j])
      j++
    }
  }

  return cloneMessages(extracted)
}

export function insertCachePriorityToolContext(
  messages: ChatCompletionMessage[],
  options: InsertCachePriorityToolContextOptions
): ChatCompletionMessage[] {
  const retainedRuns = options.retainedRuns || []
  if (retainedRuns.length === 0) return messages

  const loadRunCheckpoint = options.loadRunCheckpoint || defaultLoadRunCheckpoint
  const insertionsByIndex = new Map<number, ChatCompletionMessage[]>()
  const seenRuns = new Set<string>()

  for (const ref of retainedRuns) {
    if (!ref.runId || seenRuns.has(ref.runId)) continue
    seenRuns.add(ref.runId)

    const requestedIndex = Math.trunc(ref.assistantMessageIndex)
    if (!Number.isFinite(requestedIndex) || requestedIndex < 0) continue

    const index = resolveInsertionIndex(messages, requestedIndex)
    if (index === undefined) continue

    const checkpoint = loadRunCheckpoint(options.sessionId, ref.runId)
    if (!checkpoint) continue

    const nativeToolMessages = extractNativeToolContextMessages(checkpoint)
    if (nativeToolMessages.length === 0) continue

    const current = insertionsByIndex.get(index) || []
    current.push(...nativeToolMessages)
    insertionsByIndex.set(index, current)
  }

  if (insertionsByIndex.size === 0) return messages

  const merged: ChatCompletionMessage[] = []
  messages.forEach((message, index) => {
    const insertion = insertionsByIndex.get(index)
    if (insertion) merged.push(...cloneMessages(insertion))
    merged.push(message)
  })
  return merged
}
