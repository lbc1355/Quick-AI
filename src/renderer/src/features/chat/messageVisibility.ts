import type { Message } from '../../../../shared/types'

export const BACKGROUND_RESULT_SOURCE_PREFIX = 'background-result-source-'

export const isInternalChatMessage = (message: Message): boolean =>
  message.isInternal === true ||
  (message.isSynthetic === true && message.id.startsWith(BACKGROUND_RESULT_SOURCE_PREFIX))

export const getVisibleChatMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => !isInternalChatMessage(message))
