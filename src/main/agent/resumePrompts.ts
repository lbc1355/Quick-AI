import { ChatCompletionMessage } from '../../shared/types'
import { MEMORY_CONTEXT_PROMPT_PREFIX } from './memoryPrompts'

export const ACTION_HISTORY_RESUME_LIMIT = 12

/**
 * Resume no longer injects a `[RESUME MODE]` prompt — the checkpoint messages are replayed
 * verbatim so the first request after a resume is byte-identical to the interrupted one and hits
 * the provider's prompt cache. The prefix is still recognised so checkpoints written by older
 * builds get the stale prompt stripped instead of replayed.
 */
const RESUME_MODE_PROMPT_PREFIX = '[RESUME MODE]'

export const injectPromptBeforeLatestUser = (
  messages: ChatCompletionMessage[],
  prompt: string
): ChatCompletionMessage[] => {
  if (!prompt) return messages
  const insertAt = Math.max(1, messages.length - 1)
  messages.splice(insertAt, 0, {
    role: 'system',
    content: prompt
  })
  return messages
}

const isResumeModePrompt = (message: ChatCompletionMessage): boolean =>
  message.role === 'system' &&
  typeof message.content === 'string' &&
  message.content.startsWith(RESUME_MODE_PROMPT_PREFIX)

const isTransientContextPrompt = (message: ChatCompletionMessage): boolean =>
  isResumeModePrompt(message) ||
  (message.role === 'system' &&
    typeof message.content === 'string' &&
    message.content.startsWith(MEMORY_CONTEXT_PROMPT_PREFIX))

export const cloneMessagesForCheckpoint = (
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] => {
  return JSON.parse(
    JSON.stringify(messages.filter((message) => !isTransientContextPrompt(message)))
  ) as ChatCompletionMessage[]
}

export const buildBranchForkPrompt = (branchOf: {
  sessionId: string
  messageId: string
  runId?: string
}): string => {
  return [
    '[BRANCH MODE]',
    'This run was forked from an older point in the conversation history.',
    'The visible conversation branch starts from that older checkpoint, but the real workspace may still include side effects from later discarded or sibling runs.',
    'Do not assume files, dependencies, git state, memories, or external systems were rolled back. Inspect current state before relying on it.',
    '',
    `Fork source session: ${branchOf.sessionId}`,
    `Fork source message: ${branchOf.messageId}`,
    `Fork source run: ${branchOf.runId || 'none'}`
  ].join('\n')
}
