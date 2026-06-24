import { ChatCompletionMessage } from '../../shared/types'
import { DEFAULT_CONTEXT_SIZE, normalizeContextWindowTokens } from '../../shared/modelContext'
import { estimateMessagesTokens, estimateTokens } from './tokenEstimator'
export {
  getContextWindowInfo,
  DEFAULT_CONTEXT_SIZE,
  getContextWindowSize,
  MODEL_CONTEXT_SIZES,
  normalizeContextWindowTokens
} from '../../shared/modelContext'

export interface ContextManagerOptions {
  maxTokens: number
  reserveForResponse?: number
  reserveForResponseRatio?: number
  strategy?: 'truncate-oldest-tool'
  toolOutputSpilloverThreshold?: number
}

/**
 * Tool outputs at least this large are preserved in the run's tool-output store when produced,
 * so that if the context manager later truncates them it can leave a retrievable pointer
 * (read_tool_output) instead of silently discarding the content. Shared with the agent loop.
 */
export const MIN_TOOL_OUTPUT_SPILLOVER_THRESHOLD = 4000
export const MAX_TOOL_OUTPUT_SPILLOVER_THRESHOLD = 64000
const TOOL_OUTPUT_SPILLOVER_CONTEXT_RATIO = 0.04

export function getToolOutputSpilloverThreshold(contextWindowTokens?: number): number {
  const normalizedContextTokens =
    normalizeContextWindowTokens(contextWindowTokens) ?? DEFAULT_CONTEXT_SIZE
  const adaptiveThreshold = Math.floor(
    normalizedContextTokens * TOOL_OUTPUT_SPILLOVER_CONTEXT_RATIO
  )
  return Math.min(
    MAX_TOOL_OUTPUT_SPILLOVER_THRESHOLD,
    Math.max(MIN_TOOL_OUTPUT_SPILLOVER_THRESHOLD, adaptiveThreshold)
  )
}

export const TOOL_OUTPUT_SPILLOVER_THRESHOLD = MIN_TOOL_OUTPUT_SPILLOVER_THRESHOLD
export const DEFAULT_RESPONSE_RESERVE_RATIO = 0.04

const getMessageText = (message: ChatCompletionMessage): string => {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (part.type === 'text' ? part.text || '' : '')).join('')
  }
  return ''
}

const messageTokens = (message: ChatCompletionMessage): number => {
  const toolCallsStr = message.tool_calls ? JSON.stringify(message.tool_calls) : ''
  return estimateTokens(getMessageText(message)) + estimateTokens(toolCallsStr) + 4
}

const countLeadingSystemMessages = (messages: ChatCompletionMessage[]): number => {
  let count = 0
  while (count < messages.length && messages[count].role === 'system') {
    count++
  }
  return count
}

const getResponseReserveTokens = (options: ContextManagerOptions): number => {
  if (
    typeof options.reserveForResponse === 'number' &&
    Number.isFinite(options.reserveForResponse) &&
    options.reserveForResponse >= 0
  ) {
    return Math.floor(options.reserveForResponse)
  }
  const ratio =
    typeof options.reserveForResponseRatio === 'number' &&
    Number.isFinite(options.reserveForResponseRatio) &&
    options.reserveForResponseRatio >= 0
      ? options.reserveForResponseRatio
      : DEFAULT_RESPONSE_RESERVE_RATIO
  return Math.floor(Math.max(0, options.maxTokens) * ratio)
}

export function trimMessagesToFit(
  messages: ChatCompletionMessage[],
  options: ContextManagerOptions
): ChatCompletionMessage[] {
  const reserve = getResponseReserveTokens(options)
  const budget = Math.max(0, options.maxTokens - reserve)
  const spilloverThreshold =
    options.toolOutputSpilloverThreshold ?? getToolOutputSpilloverThreshold(options.maxTokens)
  let totalTokens = estimateMessagesTokens(messages)

  if (totalTokens <= budget) return messages

  const result = messages.map((m) => ({ ...m }))

  // Phase 1: Truncate large tool outputs in earlier messages.
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
          msg.tool_call_id && original.length > spilloverThreshold
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
  // tool results are gone), which breaks OpenAI-compatible APIs with a tool_call_id mismatch.
  const firstRemovableIndex = countLeadingSystemMessages(result)

  while (totalTokens > budget && result.length > firstRemovableIndex + protectedTail) {
    const head = result[firstRemovableIndex]

    let groupSize = 1
    if (head.role === 'assistant' && head.tool_calls && head.tool_calls.length > 0) {
      let j = firstRemovableIndex + 1
      while (j < result.length && result[j].role === 'tool') {
        groupSize++
        j++
      }
    }

    // Never remove into the protected tail; if the whole unit doesn't fit before it, stop.
    if (firstRemovableIndex + groupSize > result.length - protectedTail) break

    const removed = result.splice(firstRemovableIndex, groupSize)
    for (const msg of removed) {
      totalTokens -= messageTokens(msg)
    }
  }

  return result
}
