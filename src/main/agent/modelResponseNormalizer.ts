import type { ChatCompletionMessage } from '../../shared/types'
import { getMessageText } from './messageText'

/**
 * Some OpenAI-compatible gateways return a normal final answer in `reasoning_content` and leave
 * `content` empty. Treat that shape as a final answer only when the turn has no tool call; a
 * reasoning-only tool turn is valid and must keep its original meaning.
 *
 * The returned string is the newly promoted final chunk, if any, so streaming callers can publish
 * it before completing the run.
 */
export const promoteReasoningOnlyFinalAnswer = (
  message: ChatCompletionMessage
): string | undefined => {
  if (getMessageText(message.content).trim()) return undefined
  if (message.tool_calls?.length) return undefined

  const reasoning = message.reasoning_content
  if (typeof reasoning !== 'string' || !reasoning.trim()) return undefined

  message.content = reasoning
  return reasoning
}
