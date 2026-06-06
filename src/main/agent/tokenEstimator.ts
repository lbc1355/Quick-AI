import { ChatCompletionMessage } from '../../shared/types'

/**
 * Lightweight Token Estimator
 * English: ~4 chars / token
 * CJK (Chinese, Japanese, Korean): ~1.5 chars / token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\u3000-\u303f\uff00-\uffef]/g) || []).length
  const nonCjkLength = text.length - cjkCount
  return Math.ceil(cjkCount / 1.5 + nonCjkLength / 4)
}

export function estimateMessagesTokens(messages: ChatCompletionMessage[]): number {
  return messages.reduce((sum, msg) => {
    let contentStr = ''
    if (typeof msg.content === 'string') {
      contentStr = msg.content
    } else if (Array.isArray(msg.content)) {
      contentStr = msg.content
        .map((part) => (part.type === 'text' ? part.text || '' : ''))
        .join('')
    }
    
    let toolCallsStr = ''
    if (msg.tool_calls) {
      toolCallsStr = JSON.stringify(msg.tool_calls)
    }

    return (
      sum +
      estimateTokens(contentStr) +
      estimateTokens(msg.reasoning_content || '') +
      estimateTokens(toolCallsStr) +
      4 // role/formatting overhead
    )
  }, 0)
}
