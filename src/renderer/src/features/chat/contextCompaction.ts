import type { ContextCompactionResult, Message } from '../../../../shared/types'

/** How many recent messages `/compact` keeps verbatim behind the generated summary. */
export const MANUAL_COMPACTION_KEEP_RECENT_MESSAGES = 6

/**
 * Compaction only pays off once there is more history than the tail it would keep anyway — the
 * `+ 1` accounts for the summary message the run itself inserts.
 */
export const canCompactMessages = (
  messages: Message[],
  keepRecent = MANUAL_COMPACTION_KEEP_RECENT_MESSAGES
): boolean => messages.length > keepRecent + 1

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
}): Message[] => [
  ...input.messages.slice(0, input.result.compactedCount),
  createCompactionSummaryMessage(input.result, input.now),
  ...input.messages.slice(input.result.compactedCount)
]
