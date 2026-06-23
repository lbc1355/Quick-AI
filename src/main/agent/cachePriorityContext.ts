import { CachePriorityRetainedRunRef, ChatCompletionMessage } from '../../shared/types'
import { RunCheckpoint, loadRunCheckpoint as defaultLoadRunCheckpoint } from './runCheckpoint'

export interface InsertCachePriorityToolContextOptions {
  sessionId: string
  retainedRuns?: CachePriorityRetainedRunRef[]
  loadRunCheckpoint?: typeof defaultLoadRunCheckpoint
}

const cloneMessages = (messages: ChatCompletionMessage[]): ChatCompletionMessage[] =>
  JSON.parse(JSON.stringify(messages)) as ChatCompletionMessage[]

export function extractNativeToolContextMessages(
  checkpoint: RunCheckpoint
): ChatCompletionMessage[] {
  const extracted: ChatCompletionMessage[] = []
  const messages = checkpoint.messages || []

  for (let i = 0; i < messages.length; i++) {
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

    const index = Math.trunc(ref.assistantMessageIndex)
    if (!Number.isFinite(index) || index < 0 || index >= messages.length) continue
    if (messages[index]?.role !== 'assistant') continue

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
