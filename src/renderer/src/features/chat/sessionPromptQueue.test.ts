import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import {
  appendQueuedPromptToSession,
  applyBackgroundSubagentNotification,
  applySteeredPromptToSession,
  materializeBackgroundPrompt,
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

  it('materializes a durable background result that has no renderer message pair yet', () => {
    const materialized = materializeBackgroundPrompt(baseSession(), {
      id: 'admission-bg',
      sessionId: 'session-1',
      contextEpoch: 2,
      mode: 'steer',
      status: 'running',
      runMode: 'agent',
      sourceMessageId: 'background-result-source-job-1',
      assistantMessageId: 'background-result-assistant-job-1',
      messages: [{ role: 'user', content: 'background result' }],
      createdAt: 1,
      updatedAt: 1
    })

    expect(materialized.messages.slice(-2)).toMatchObject([
      { role: 'user', content: 'background result', isSynthetic: true },
      { role: 'assistant' }
    ])
  })

  it('records completion on the original subagent card and persists a steered result', () => {
    const source: Session = {
      ...baseSession(),
      messages: baseSession().messages.map((message) =>
        message.id === 'assistant-active'
          ? {
              ...message,
              agentEvents: [
                {
                  type: 'subagent_start',
                  subagentId: 'subagent-1',
                  parentToolCallId: 'call-1',
                  label: 'Research',
                  task: 'Inspect',
                  maxSteps: 4
                }
              ]
            }
          : message
      )
    }
    const next = applyBackgroundSubagentNotification(
      source,
      {
        jobId: 'job-1',
        subagentId: 'subagent-1',
        parentToolCallId: 'call-1',
        task: 'Inspect',
        label: 'Research',
        status: 'completed',
        result: 'Done',
        sessionId: 'session-1',
        contextEpoch: 0,
        parentRunId: 'run-active',
        disposition: 'steered',
        prompt: {
          id: 'admission-bg',
          sessionId: 'session-1',
          contextEpoch: 0,
          mode: 'steer',
          status: 'running',
          runMode: 'agent',
          sourceMessageId: 'background-result-source-job-1',
          assistantMessageId: 'background-result-assistant-job-1',
          messages: [{ role: 'user', content: 'background result' }],
          createdAt: 1,
          updatedAt: 1
        }
      },
      'assistant-active'
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'user-active',
      'background-result-source-job-1',
      'assistant-active'
    ])
    expect(next.messages[1]).toMatchObject({ isSynthetic: true, content: 'background result' })
    expect(next.messages[2].agentEvents).toContainEqual(
      expect.objectContaining({
        type: 'subagent_end',
        subagentId: 'subagent-1',
        status: 'completed'
      })
    )
  })

  it('attaches a fast completion to the parent run before its start event is flushed', () => {
    const next = applyBackgroundSubagentNotification(baseSession(), {
      jobId: 'job-fast',
      subagentId: 'subagent-fast',
      parentToolCallId: 'call-fast',
      task: 'Inspect',
      label: 'Research',
      status: 'completed',
      result: 'Done',
      sessionId: 'session-1',
      contextEpoch: 0,
      parentRunId: 'run-active',
      parentAssistantMessageId: 'assistant-active',
      disposition: 'queued'
    })

    expect(next.messages[1].agentEvents).toContainEqual(
      expect.objectContaining({ type: 'subagent_end', subagentId: 'subagent-fast' })
    )
  })
})
