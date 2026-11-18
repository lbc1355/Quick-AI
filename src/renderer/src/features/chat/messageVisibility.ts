import type { Message } from '../../../../shared/types'
import { isBackgroundResultSourceMessage } from '../../../../shared/backgroundResultSource'

export const isInternalChatMessage = (message: Message): boolean =>
  message.isInternal === true || isBackgroundResultSourceMessage(message)

export const getVisibleChatMessages = (messages: Message[]): Message[] =>
  messages.filter((message) => !isInternalChatMessage(message))
