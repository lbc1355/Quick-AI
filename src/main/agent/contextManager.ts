import { ChatCompletionMessage } from '../../shared/types'
import { estimateMessagesTokens, estimateTokens } from './tokenEstimator'

export interface ContextManagerOptions {
  maxTokens: number
  reserveForResponse: number
  strategy?: 'truncate-oldest-tool' | 'summarize'
}

export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  'moonshot-v1-8k': 8000,
  'moonshot-v1-32k': 32000,
  'moonshot-v1-128k': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000
}

const DEFAULT_CONTEXT_SIZE = 16000

export function getContextWindowSize(modelName: string): number {
  if (!modelName) return DEFAULT_CONTEXT_SIZE
  const lower = modelName.toLowerCase()

  if (MODEL_CONTEXT_SIZES[lower]) {
    return MODEL_CONTEXT_SIZES[lower]
  }

  // Dynamic inference from model name suffixes (e.g. "xxx-128k", "xxx_32k", "xxx-1m")
  const sizeMatch = lower.match(/[-_](\d+)(k|m)\b/)
  if (sizeMatch) {
    const num = parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]
    const tokens = unit === 'm' ? num * 1000000 : num * 1000
    if (tokens >= 2000 && tokens <= 10000000) {
      return tokens
    }
  }

  return DEFAULT_CONTEXT_SIZE
}

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
        const truncated =
          original.slice(0, 300) + '\n\n[... content truncated to fit context window ...]'
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
    return (
      estimateTokens(contentStr) +
      estimateTokens(m.reasoning_content || '') +
      estimateTokens(toolCallsStr) +
      4
    )
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
