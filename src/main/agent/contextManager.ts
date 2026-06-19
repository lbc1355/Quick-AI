import { ChatCompletionMessage } from '../../shared/types'
import { estimateMessagesTokens, estimateTokens } from './tokenEstimator'
export {
  getContextWindowInfo,
  DEFAULT_CONTEXT_SIZE,
  getContextWindowSize,
  MODEL_CONTEXT_SIZES
} from '../../shared/modelContext'

export interface ContextManagerOptions {
  maxTokens: number
  reserveForResponse: number
  strategy?: 'truncate-oldest-tool' | 'summarize'
}

/**
 * Tool outputs at least this large are preserved in the run's tool-output store when produced,
 * so that if the context manager later truncates them it can leave a retrievable pointer
 * (read_tool_output) instead of silently discarding the content. Shared with the agent loop.
 */
export const TOOL_OUTPUT_SPILLOVER_THRESHOLD = 2000

export function trimMessagesToFit(
  messages: ChatCompletionMessage[],
  options: ContextManagerOptions
): ChatCompletionMessage[] {
  const reserve = options.reserveForResponse || 2000
  const budget = options.maxTokens - reserve
  let totalTokens = estimateMessagesTokens(messages)

  if (totalTokens <= budget) return messages

  const result = messages.map((m) => ({ ...m }))

  // Phase 1: Truncate large tool outputs in earlier messages
  // Keep system prompt (index 0) and protect the tail (e.g. last 4 messages)
  const protectedTail = Math.min(4, result.length - 1)
  const maxTruncatableIndex = result.length - protectedTail

  for (let i = 1; i < maxTruncatableIndex && totalTokens > budget; i++) {
    const msg = result[i]
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      const original = msg.content
      if (original.length > 500) {
        // If the full output was preserved in the run's tool-output store, leave a pointer the
        // model can follow instead of silently dropping the tail.
        const pointer =
          msg.tool_call_id && original.length > TOOL_OUTPUT_SPILLOVER_THRESHOLD
            ? ` The full ${original.length}-character output can be retrieved with read_tool_output(output_id="${msg.tool_call_id}").`
            : ''
        const truncated =
          original.slice(0, 300) +
          `\n\n[... content truncated to fit the context window.${pointer} ...]`
        const saved = estimateTokens(original) - estimateTokens(truncated)
        result[i] = { ...msg, content: truncated }
        totalTokens -= saved
      }
    }
  }

  // Phase 2: If still exceeding, drop the oldest messages in coherent units.
  // An assistant message carrying tool_calls is removed together with its following
  // tool responses, so we never leave an orphaned tool message (or an assistant whose
  // tool results are gone) — both break OpenAI-compatible APIs with a tool_call_id mismatch.
  const messageTokens = (m: ChatCompletionMessage): number => {
    let contentStr = ''
    if (typeof m.content === 'string') {
      contentStr = m.content
    } else if (Array.isArray(m.content)) {
      contentStr = m.content.map((p) => (p.type === 'text' ? p.text || '' : '')).join('')
    }
    const toolCallsStr = m.tool_calls ? JSON.stringify(m.tool_calls) : ''
    return estimateTokens(contentStr) + estimateTokens(toolCallsStr) + 4
  }

  while (totalTokens > budget && result.length > protectedTail + 1) {
    const head = result[1]

    // Determine the size of the removable unit starting at index 1.
    let groupSize = 1
    if (head.role === 'assistant' && head.tool_calls && head.tool_calls.length > 0) {
      let j = 2
      while (j < result.length && result[j].role === 'tool') {
        groupSize++
        j++
      }
    }

    // Never remove into the protected tail; if the whole unit doesn't fit before it, stop.
    if (1 + groupSize > result.length - protectedTail) break

    const removed = result.splice(1, groupSize)
    for (const msg of removed) {
      totalTokens -= messageTokens(msg)
    }
  }

  return result
}
