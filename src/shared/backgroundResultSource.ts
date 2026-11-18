import type { Message } from './types'

export const BACKGROUND_RESULT_SOURCE_PREFIX = 'background-result-source-'

export function isBackgroundResultSourceMessage(message: Pick<Message, 'id' | 'role'>): boolean {
  return message.role === 'user' && message.id.startsWith(BACKGROUND_RESULT_SOURCE_PREFIX)
}
