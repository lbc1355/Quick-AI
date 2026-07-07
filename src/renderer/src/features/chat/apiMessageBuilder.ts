import type { Message } from '../../../../shared/types'
import { isRuntimeErrorAssistantMessage } from '../../hooks/chatMessageEvents'

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
  let startIndex = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isCompactionSummary) {
      startIndex = i
      break
    }
  }
  return messages.slice(startIndex)
}

export function buildApiMessages(systemPrompt: string, messages: Message[]): ApiMessage[] {
  const apiMessages: ApiMessage[] = []
  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt })
  }

  // Crop context to messages after the last compaction summary
  const messagesToProcess = getMessagesForLLM(messages)

  messagesToProcess.forEach((msg) => {
    if (isRuntimeErrorAssistantMessage(msg)) return

    let content:
      | string
      | Array<{
          type: string
          text?: string
          image_url?: { url: string }
        }> = msg.content

    if (msg.files && msg.files.length > 0) {
      const textParts = [msg.content]
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
