import type { Message } from '../../../../shared/types'
import { buildDateContext, getDateFromMessageId, getDateKey } from '../../../../shared/promptDate'
import { isRuntimeErrorAssistantMessage } from '../../hooks/chatMessageEvents'
import { getMessagesForCurrentContext } from '../../utils/contextMessages'

export interface ApiMessage {
  role: string
  content:
    | string
    | Array<{
        type: string
        text?: string
        image_url?: { url: string }
      }>
}

export function getMessagesForLLM(messages: Message[]): Message[] {
  return getMessagesForCurrentContext(messages)
}

export function buildApiMessages(systemPrompt: string, messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = []
  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt })
  }

  // Crop context to messages after the last compaction summary
  const messagesToProcess = getMessagesForLLM(messages)

  // Only anchor the date on a user message when the calendar day differs from the previously
  // anchored user message (the first dated user message in the window always gets one). This
  // avoids repeating the same date on every turn while keeping each turn deterministic on replay.
  let lastAnchoredDateKey: string | null = null

  messagesToProcess.forEach((msg) => {
    if (isRuntimeErrorAssistantMessage(msg)) return

    let dateContext: string | null = null
    if (msg.role === 'user') {
      const date = getDateFromMessageId(msg.id)
      if (date) {
        const dateKey = getDateKey(date)
        if (dateKey !== lastAnchoredDateKey) {
          dateContext = buildDateContext(date)
          lastAnchoredDateKey = dateKey
        }
      }
    }
    const textContent = dateContext ? `${dateContext}\n\n${msg.content}` : msg.content
    let content:
      | string
      | Array<{
          type: string
          text?: string
          image_url?: { url: string }
        }> = textContent

    if (msg.files && msg.files.length > 0) {
      const textParts = [textContent]
      const images: Array<{ type: 'image_url'; image_url: { url: string } }> = []
      msg.files.forEach((f) => {
        if (f.type === 'image') {
          images.push({
            type: 'image_url',
            image_url: { url: f.content }
          })
        } else {
          textParts.push(`\n[参考文件: ${f.name}]\n${f.content}`)
        }
      })

      if (images.length > 0) {
        content = [{ type: 'text', text: textParts.join('\n') }, ...images]
      } else {
        content = textParts.join('\n')
      }
    }
    apiMessages.push({ role: msg.role, content })
  })

  return apiMessages
}
