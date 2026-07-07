import { ChatCompletionMessage } from '../../shared/types'

/**
 * Flatten a chat message's `content` to plain text. Strings pass through; array (multi-part)
 * content is reduced to the concatenation of its text parts, ignoring non-text parts (images,
 * etc.). Shared by the agent loop, tool-turn runners, and the subagent runner, which all need the
 * assistant's textual answer regardless of how the provider shaped the content.
 */
export const getMessageText = (content: ChatCompletionMessage['content']): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}
