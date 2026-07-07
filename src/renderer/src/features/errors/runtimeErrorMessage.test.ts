import { describe, it, expect } from 'vitest'
import { applyRuntimeErrorToMessage } from './runtimeErrorMessage'
import { Message, AgentEvent } from '../../../../shared/types'
import { RuntimeErrorPayload } from '../../../../shared/runtimeErrors'

describe('runtimeErrorMessage', () => {
  it('applies errorText and category correctly to an empty message', () => {
    const errorText = 'Rate limit exceeded'
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: ''
    }

    const updater = applyRuntimeErrorToMessage(errorText)
    const result = updater(msg)

    expect(result.content).toBe(errorText)
    expect(result.isRuntimeError).toBe(true)
    expect(result.errorPayload).toBeDefined()
    expect(result.errorPayload?.category).toBe('rate_limit')
    expect(result.agentEvents).toEqual([])
  })

  it('appends a final agent event if the message already has events', () => {
    const errorText = 'API key issue'
    const payload: RuntimeErrorPayload = {
      message: errorText,
      category: 'unauthorized',
      source: 'model_api',
      timestamp: 12345
    }
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'running...',
      agentEvents: [
        { type: 'subagent_start', content: 'Starting subagent' } as unknown as AgentEvent
      ]
    }

    const updater = applyRuntimeErrorToMessage(errorText, payload)
    const result = updater(msg)

    expect(result.content).toBe(errorText)
    expect(result.isRuntimeError).toBe(true)
    expect(result.errorPayload).toEqual(payload)
    expect(result.agentEvents).toHaveLength(2)
    expect(result.agentEvents?.[1]).toEqual({ type: 'final', content: errorText })
  })
})
