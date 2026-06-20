import { describe, expect, it } from 'vitest'
import { ChatCompletionMessage } from '../../shared/types'
import { ToolModelAttachment } from '../tools/types'
import { finalizeToolStep } from './toolStepFinalizer'

describe('finalizeToolStep', () => {
  it('returns ordered tool messages, visual attachment follow-up, and last recorded call id', () => {
    const toolResponses: Array<ChatCompletionMessage | undefined> = [
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'file_read',
        content: 'first'
      },
      undefined,
      {
        role: 'tool',
        tool_call_id: 'call-3',
        name: 'image_read',
        content: 'image read'
      }
    ]
    const image: ToolModelAttachment = {
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,abc'
      }
    }

    const result = finalizeToolStep({
      toolResponses,
      toolModelAttachments: [undefined, [image], undefined]
    })

    expect(result.lastRecordedCallId).toBe('call-3')
    expect(result.visualAttachmentCount).toBe(1)
    expect(result.messagesToAppend).toEqual([
      toolResponses[0],
      toolResponses[2],
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Visual context from image_read: 1 image(s) attached. Analyze the attached image content directly when it is relevant to the user\'s request.'
          },
          image
        ]
      }
    ])
  })

  it('omits the visual follow-up when there are no model attachments', () => {
    const toolResponses: Array<ChatCompletionMessage | undefined> = [
      undefined,
      {
        role: 'tool',
        tool_call_id: 'call-2',
        name: 'file_read',
        content: 'second'
      }
    ]

    const result = finalizeToolStep({
      toolResponses,
      toolModelAttachments: []
    })

    expect(result.lastRecordedCallId).toBe('call-2')
    expect(result.visualAttachmentCount).toBe(0)
    expect(result.messagesToAppend).toEqual([toolResponses[1]])
  })
})
