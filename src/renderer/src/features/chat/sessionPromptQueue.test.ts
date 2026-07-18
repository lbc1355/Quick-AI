import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import {
  appendQueuedPromptToSession,
  applySteeredPromptToSession,
  prepareClaimedPromptRun
} from './sessionPromptQueue'

const baseSession = (): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: [
    { id: 'user-active', role: 'user', content: 'active prompt' },
    {
      id: 'assistant-active',
      role: 'assistant',
      content: 'partial answer',
      agentRunId: 'run-active'
    }
  ]
})

describe('session prompt queue UI mutations', () => {
  it('appends a queued user/assistant pair without mutating the source session', () => {
    const source = baseSession()
    const next = appendQueuedPromptToSession(
      source,
      { id: 'user-queued', role: 'user', content: 'next prompt' },
      { id: 'assistant-queued', role: 'assistant', content: 'Queued' }
    )

    expect(source.messages).toHaveLength(2)
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-active',
      'assistant-active',
      'user-queued',
      'assistant-queued'
    ])
  })

  it('moves an accepted steer before the active assistant and removes its queue placeholder', () => {
    const queued = appendQueuedPromptToSession(
      baseSession(),
      { id: 'user-steer', role: 'user', content: 'change direction' },
      { id: 'assistant-steer', role: 'assistant', content: 'Queued' }
    )
    const steered = applySteeredPromptToSession(
      queued,
      'user-steer',
      'assistant-steer',
      'assistant-active'
    )

    expect(steered.messages.map((message) => message.id)).toEqual([
      'user-active',
      'user-steer',
      'assistant-active'
    ])
  })

  it('prepares only the claimed prompt prefix and resets its assistant placeholder', () => {
    const withTwoQueued: Session = {
      ...baseSession(),
      messages: [
        ...baseSession().messages,
        { id: 'user-1', role: 'user', content: 'first queued' },
        { id: 'assistant-1', role: 'assistant', content: 'Queued' },
        { id: 'user-2', role: 'user', content: 'second queued' },
        { id: 'assistant-2', role: 'assistant', content: 'Queued' }
      ]
    }

    const prepared = prepareClaimedPromptRun(
      withTwoQueued,
      'user-1',
      'assistant-1',
      'run-1',
      'agent'
    )

    expect(prepared?.messagesBeforeAssistant.map((message) => message.id)).toEqual([
      'user-active',
      'assistant-active',
      'user-1'
    ])
    expect(
      prepared?.session.messages.find((message) => message.id === 'assistant-1')
    ).toMatchObject({
      content: '',
      agentRunId: 'run-1',
      agentRunIds: ['run-1'],
      agentEvents: []
    })
    expect(
      prepared?.session.messages.find((message) => message.id === 'assistant-2')?.content
    ).toBe('Queued')
  })
})
