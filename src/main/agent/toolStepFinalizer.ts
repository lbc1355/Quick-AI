import { ChatCompletionMessage } from '../../shared/types'
import { ToolModelAttachment } from '../tools/types'

export interface FinalizeToolStepOptions {
  toolResponses: Array<ChatCompletionMessage | undefined>
  toolModelAttachments: Array<ToolModelAttachment[] | undefined>
}

export interface FinalizeToolStepResult {
  messagesToAppend: ChatCompletionMessage[]
  lastRecordedCallId?: string
  visualAttachmentCount: number
}

export function finalizeToolStep(options: FinalizeToolStepOptions): FinalizeToolStepResult {
  const toolMessages = options.toolResponses.filter(
    (response): response is ChatCompletionMessage => !!response
  )
  const visualAttachments = options.toolModelAttachments.flatMap((attachments) => attachments || [])
  const messagesToAppend = [...toolMessages]

  if (visualAttachments.length > 0) {
    messagesToAppend.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Visual context from image_read: ${visualAttachments.length} image(s) attached. Analyze the attached image content directly when it is relevant to the user's request.`
        },
        ...visualAttachments
      ]
    })
  }

  return {
    messagesToAppend,
    lastRecordedCallId: [...options.toolResponses]
      .reverse()
      .find((response): response is ChatCompletionMessage => !!response)?.tool_call_id,
    visualAttachmentCount: visualAttachments.length
  }
}
