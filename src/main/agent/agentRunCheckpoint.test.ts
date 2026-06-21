import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { persistAgentRunCheckpoint } from './agentRunCheckpoint'
import { AmbiguousAction } from './runCheckpoint'

const createAmbiguousAction = (index: number): AmbiguousAction => ({
  callId: `call-${index}`,
  toolName: 'shell',
  args: { command: `command-${index}` },
  reason: `reason-${index}`,
  timestamp: index
})

describe('persistAgentRunCheckpoint', () => {
  it('saves a cloned checkpoint and records it in the run manifest', () => {
    const messages: ChatCompletionMessage[] = [{ role: 'user', content: 'hello' }]
    const clonedMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'cloned hello' }]
    const saveRunCheckpoint = vi.fn()
    const appendRunCheckpoint = vi.fn()
    const cloneMessagesForCheckpoint = vi.fn(() => clonedMessages)
    const ambiguousActions = Array.from({ length: 14 }, (_, index) =>
      createAmbiguousAction(index + 1)
    )

    persistAgentRunCheckpoint({
      conversationId: 'conversation-1',
      reqId: 'run-1',
      step: 3,
      messages,
      activeTools: new Set(['search_tools', 'file_read']),
      lastCompletedCallId: 'call-14',
      ambiguousActions,
      dependencies: {
        saveRunCheckpoint,
        appendRunCheckpoint,
        cloneMessagesForCheckpoint
      }
    })

    expect(cloneMessagesForCheckpoint).toHaveBeenCalledWith(messages)
    expect(saveRunCheckpoint).toHaveBeenCalledWith({
      sessionId: 'conversation-1',
      reqId: 'run-1',
      step: 3,
      messages: clonedMessages,
      activeTools: ['search_tools', 'file_read'],
      lastCompletedCallId: 'call-14',
      ambiguousActions: ambiguousActions.slice(-12)
    })
    expect(appendRunCheckpoint).toHaveBeenCalledWith('conversation-1', 'run-1', 'run-1')
  })

  it('logs checkpoint persistence failures without throwing', () => {
    const warn = vi.fn()

    expect(() =>
      persistAgentRunCheckpoint({
        conversationId: 'conversation-1',
        reqId: 'run-1',
        step: 1,
        messages: [],
        activeTools: [],
        ambiguousActions: [],
        dependencies: {
          saveRunCheckpoint: vi.fn(() => {
            throw new Error('disk full')
          }),
          appendRunCheckpoint: vi.fn(),
          cloneMessagesForCheckpoint: vi.fn((messages) => messages),
          warn
        }
      })
    ).not.toThrow()

    expect(warn).toHaveBeenCalledWith('Failed to save run checkpoint:', 'disk full')
  })
})
