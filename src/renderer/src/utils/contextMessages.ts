import type { Message } from '../../../shared/types'

/**
 * Return the messages that will participate in the next model request.
 * Historical messages remain visible in the UI after compaction, but the latest
 * compaction summary replaces everything before it in the effective context.
 */
export function getMessagesForCurrentContext(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].isCompactionSummary) return messages.slice(index)
  }
  return messages
}
