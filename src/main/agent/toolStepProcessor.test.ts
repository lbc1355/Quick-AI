import { describe, expect, it, vi } from 'vitest'
import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { ToolModelAttachment } from '../tools/types'
import { PreparedToolCall } from './toolCallPlanning'
import { processPreparedToolStep } from './toolStepProcessor'

const makePrep = (overrides: Partial<PreparedToolCall> = {}): PreparedToolCall => ({
  index: 0,
  toolCall: {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'test_tool',
      arguments: '{}'
    }
  },
  toolName: 'test_tool',
  callId: 'call-1',
  args: {},
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification: 'direct',
  ...overrides
})

describe('processPreparedToolStep', () => {
  it('emits step lifecycle events and marks the step failed when a tool error is emitted', async () => {
    const events: AgentEvent[] = []
    const prep = makePrep({
      callId: 'call-1',
      toolName: 'file_read',
      purpose: 'read file'
    })
    const executeTool = vi.fn(
      async (
        call: PreparedToolCall,
        _approved: boolean,
        emitToolEvents: (events: AgentEvent[]) => void
      ): Promise<ChatCompletionMessage> => {
        emitToolEvents([
          {
            type: 'tool_error',
            callId: call.callId,
            error: 'read failed'
          }
        ])
        return {
          role: 'tool',
          tool_call_id: call.callId,
          name: call.toolName,
          content: 'ERROR: read failed'
        }
      }
    )

    const result = await processPreparedToolStep({
      toolCallCount: 1,
      preparedCalls: [prep],
      askCalls: [],
      directCalls: [prep],
      blockedCalls: [],
      step: 2,
      maxSteps: 8,
      stepId: 'step-2',
      title: 'Read file',
      message: 'Reading a file',
      signal: new AbortController().signal,
      emitEvent: (event) => events.push(event),
      requestPermission: vi.fn(),
      isToolApproved: () => false,
      isCommandPrefixApproved: () => false,
      executeTool,
      toolModelAttachments: []
    })

    expect(result.status).toBe('failed')
    expect(result.lastRecordedCallId).toBe('call-1')
    expect(result.messagesToAppend).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'file_read',
        content: 'ERROR: read failed'
      }
    ])
    expect(events).toEqual([
      {
        type: 'agent_step',
        stepId: 'step-2',
        step: 2,
        maxSteps: 8,
        title: 'Read file',
        message: 'Reading a file',
        status: 'running'
      },
      {
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'file_read',
        args: {},
        purpose: 'read file',
        permissionState: 'approved',
        step: 2,
        stepId: 'step-2'
      },
      {
        type: 'tool_error',
        callId: 'call-1',
        error: 'read failed',
        step: 2,
        stepId: 'step-2'
      },
      {
        type: 'agent_step_end',
        stepId: 'step-2',
        status: 'failed'
      }
    ])
  })

  it('appends visual attachment messages when tools produce model attachments', async () => {
    const image: ToolModelAttachment = {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc' }
    }
    const prep = makePrep({
      callId: 'call-image',
      toolName: 'image_read'
    })

    const result = await processPreparedToolStep({
      toolCallCount: 1,
      preparedCalls: [prep],
      askCalls: [],
      directCalls: [prep],
      blockedCalls: [],
      step: 1,
      maxSteps: 8,
      stepId: 'step-1',
      title: 'Read image',
      message: 'Reading image',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      requestPermission: vi.fn(),
      isToolApproved: () => false,
      isCommandPrefixApproved: () => false,
      executeTool: async (call) => ({
        role: 'tool',
        tool_call_id: call.callId,
        name: call.toolName,
        content: 'image read'
      }),
      toolModelAttachments: [[image]]
    })

    expect(result.status).toBe('completed')
    expect(result.messagesToAppend).toHaveLength(2)
    expect(result.messagesToAppend[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: "Visual context from image_read: 1 image(s) attached. Analyze the attached image content directly when it is relevant to the user's request."
        },
        image
      ]
    })
  })
})
