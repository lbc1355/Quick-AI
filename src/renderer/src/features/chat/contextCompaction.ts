import { estimateMessagesTokens } from '../../../../shared/tokenEstimator'
import type {
  ChatCompletionMessage,
  ContextCompactionResult,
  Message
} from '../../../../shared/types'
import { getMessagesForCurrentContext } from '../../utils/contextMessages'

/** How many recent messages `/compact` keeps verbatim behind the generated summary. */
export const MANUAL_COMPACTION_KEEP_RECENT_MESSAGES = 6
export const AUTO_COMPACTION_TRIGGER_RATIO = 0.8
export const AUTO_COMPACTION_RETAIN_RATIO = 0.16

export interface ContextCompactionPressureDecision {
  shouldCompact: boolean
  measuredTokens: number
  triggerTokens: number
}

/** Only the latest checkpoint and the messages after it belong to the effective model context. */
export const getMessagesForCompaction = (messages: Message[]): Message[] =>
  getMessagesForCurrentContext(messages)

/**
 * Compaction only pays off once there is more history than the tail it would keep anyway — the
 * `+ 1` accounts for the summary message the run itself inserts.
 */
export const canCompactMessages = (
  messages: Message[],
  keepRecent = MANUAL_COMPACTION_KEEP_RECENT_MESSAGES
): boolean => getMessagesForCompaction(messages).length > keepRecent + 1

const estimateDurableMessageTokens = (message: Message): number => {
  if (message.isRuntimeError) return 0
  const textAttachments = (message.files || [])
    .filter((file) => file.type !== 'image')
    .map((file) => `\n[Reference file: ${file.name}]\n${file.content}`)
  return estimateMessagesTokens([
    { role: message.role, content: [message.content, ...textAttachments].join('\n') }
  ])
}

/**
 * Price the recent verbatim tail by tokens instead of message count. Two latest messages are kept
 * at minimum so an oversized final turn does not leave a checkpoint detached from the request it
 * answers. Returning the whole effective history intentionally makes `canCompactMessages` refuse
 * when the requested retention budget cannot be met by a smaller tail.
 */
export const selectAutoCompactionKeepRecentMessages = (input: {
  messages: Message[]
  contextWindowTokens: number
  retainRatio?: number
  minimumMessages?: number
}): number => {
  const effective = getMessagesForCompaction(input.messages)
  const minimumMessages = Math.max(1, input.minimumMessages ?? 2)
  const retainRatio = input.retainRatio ?? AUTO_COMPACTION_RETAIN_RATIO
  const retainTokens = Math.floor(Math.max(0, input.contextWindowTokens) * retainRatio)
  let accumulatedTokens = 0
  let keptMessages = 0

  for (let index = effective.length - 1; index >= 0; index -= 1) {
    accumulatedTokens += estimateDurableMessageTokens(effective[index])
    keptMessages += 1
    if (keptMessages >= minimumMessages && accumulatedTokens >= retainTokens) break
  }

  return keptMessages
}

/**
 * Decide whether the durable conversation needs model-assisted compaction before another run.
 * This deliberately measures only the durable conversation request. Provider prompt usage also
 * includes tool declarations and cached tool-result replay; those belong to the model-free first
 * stage in the main process and must not cause an unnecessary summary call here.
 */
export const assessContextCompactionPressure = (input: {
  messages: Message[]
  requestMessages: ChatCompletionMessage[]
  contextWindowTokens: number
  keepRecentMessages?: number
  triggerRatio?: number
}): ContextCompactionPressureDecision => {
  const measuredTokens = estimateMessagesTokens(input.requestMessages)
  const ratio = input.triggerRatio ?? AUTO_COMPACTION_TRIGGER_RATIO
  const triggerTokens = Math.floor(Math.max(0, input.contextWindowTokens) * ratio)
  return {
    shouldCompact:
      input.contextWindowTokens > 0 &&
      measuredTokens >= triggerTokens &&
      canCompactMessages(input.messages, input.keepRecentMessages),
    measuredTokens,
    triggerTokens
  }
}

export const formatCompactionSummaryMessage = (result: ContextCompactionResult): string =>
  [
    '### 上下文压缩摘要',
    '',
    `已使用模型总结前 ${result.compactedCount} 条历史消息，最近 ${result.keptCount} 条消息保留原文。`,
    result.tokenSpeed !== undefined ? `压缩生成速度：${result.tokenSpeed} token/s。` : '',
    '',
    result.summary
  ]
    .filter(Boolean)
    .join('\n')

export const createCompactionSummaryMessage = (
  result: ContextCompactionResult,
  now: number
): Message => ({
  id: `compact-${now}`,
  role: 'assistant',
  content: formatCompactionSummaryMessage(result),
  isCompactionSummary: true,
  ...(result.tokenSpeed !== undefined ? { tokenSpeed: result.tokenSpeed } : {})
})

/**
 * Splice the generated summary between the compacted history and the kept tail.
 *
 * The compacted messages stay in the array — `getMessagesForLLM` crops at the newest summary, so
 * the model stops seeing them while the user can still scroll back through them.
 */
export const applyCompactionResult = (input: {
  messages: Message[]
  result: ContextCompactionResult
  now: number
}): Message[] => {
  const effective = getMessagesForCompaction(input.messages)
  const effectiveStart = input.messages.length - effective.length
  const boundary = Math.min(
    input.messages.length,
    effectiveStart + Math.max(0, input.result.compactedCount)
  )
  return [
    ...input.messages.slice(0, boundary),
    createCompactionSummaryMessage(input.result, input.now),
    ...input.messages.slice(boundary)
  ]
}
