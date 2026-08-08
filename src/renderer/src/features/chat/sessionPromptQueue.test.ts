import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import {
  appendQueuedPromptToSession,
  applyBackgroundShellNotification,
  applyBackgroundSubagentEventNotification,
  applyBackgroundSubagentNotification,
  applySteeredAdmission,
  applySteeredPromptToSession,
  markQueuedPromptInSessions,
  materializeBackgroundPrompt,
  prepareClaimedPromptRun,
  removeQueuedPromptFromSessions
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

  it('marks both visible messages only after durable queue admission', () => {
    const appended = appendQueuedPromptToSession(
      baseSession(),
      { id: 'user-queued', role: 'user', content: 'next prompt' },
      { id: 'assistant-queued', role: 'assistant', content: 'Queued' }
    )
    expect(appended.messages.find((message) => message.id === 'user-queued')?.queuedPrompt).toBe(
      undefined
    )

    const [marked] = markQueuedPromptInSessions([appended], {
      admissionId: 'admission-queued',
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      assistantMessageId: 'assistant-queued'
    })
    expect(marked.messages.find((message) => message.id === 'user-queued')?.queuedPrompt).toEqual({
      admissionId: 'admission-queued',
      sessionId: 'session-1',
      assistantMessageId: 'assistant-queued'
    })
    expect(
      marked.messages.find((message) => message.id === 'assistant-queued')?.queuedPrompt
    ).toEqual({
      admissionId: 'admission-queued',
      sessionId: 'session-1',
      assistantMessageId: 'assistant-queued'
    })
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

  it('removes only the cancelled pending prompt pair', () => {
    const source = appendQueuedPromptToSession(
      baseSession(),
      {
        id: 'user-queued',
        role: 'user',
        content: 'cancel me',
        queuedPrompt: {
          admissionId: 'admission-queued',
          sessionId: 'session-1',
          assistantMessageId: 'assistant-queued'
        }
      },
      { id: 'assistant-queued', role: 'assistant', content: 'Queued' }
    )

    const [cancelled] = removeQueuedPromptFromSessions([source], {
      admissionId: 'admission-queued',
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      assistantMessageId: 'assistant-queued'
    })

    expect(cancelled.messages.map((message) => message.id)).toEqual([
      'user-active',
      'assistant-active'
    ])
    expect(source.messages.map((message) => message.id)).toContain('user-queued')
  })

  it('keeps the transcript when cancellation identity is stale', () => {
    const source = appendQueuedPromptToSession(
      baseSession(),
      {
        id: 'user-queued',
        role: 'user',
        content: 'already claimed',
        queuedPrompt: {
          admissionId: 'admission-current',
          sessionId: 'session-1',
          assistantMessageId: 'assistant-queued'
        }
      },
      { id: 'assistant-queued', role: 'assistant', content: 'Queued' }
    )

    const [unchanged] = removeQueuedPromptFromSessions([source], {
      admissionId: 'admission-stale',
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      assistantMessageId: 'assistant-queued'
    })
    expect(unchanged).toBe(source)
  })

  it('prepares only the claimed prompt prefix and resets its assistant placeholder', () => {
    const withTwoQueued: Session = {
      ...baseSession(),
      messages: [
        ...baseSession().messages,
        {
          id: 'user-1',
          role: 'user',
          content: 'first queued',
          queuedPrompt: {
            admissionId: 'admission-1',
            sessionId: 'session-1',
            assistantMessageId: 'assistant-1'
          }
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Queued',
          queuedPrompt: {
            admissionId: 'admission-1',
            sessionId: 'session-1',
            assistantMessageId: 'assistant-1'
          }
        },
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
    expect(
      prepared?.session.messages.find((message) => message.id === 'user-1')?.queuedPrompt
    ).toBeUndefined()
    expect(
      prepared?.session.messages.find((message) => message.id === 'assistant-1')?.queuedPrompt
    ).toBeUndefined()
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
      {
        role: 'user',
        content: 'background result',
        isSynthetic: true,
        isInternal: true
      },
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
    expect(next.messages[1]).toMatchObject({
      isSynthetic: true,
      isInternal: true,
      content: 'background result'
    })
    expect(next.messages[2].agentEvents).toContainEqual(
      expect.objectContaining({
        type: 'subagent_end',
        subagentId: 'subagent-1',
        status: 'completed'
      })
    )
  })

  it('inserts a steered shell result as an internal source before the active response', () => {
    const next = applyBackgroundShellNotification(
      baseSession(),
      {
        jobId: 'shell-1',
        command: 'npm test',
        status: 'completed',
        output: 'passed',
        resourceId: '11111111111111111111111111111111',
        resource: {
          id: '11111111111111111111111111111111',
          kind: 'terminal',
          source: 'shell-output://shell-1',
          title: 'Shell output: npm test',
          totalChars: 6,
          fetchedRanges: [{ start: 0, end: 6 }],
          status: 'complete',
          chunks: [{ id: 'chunk-1', offset: 0, endOffset: 6, createdAt: 1 }],
          createdAt: 1,
          updatedAt: 1
        },
        sessionId: 'session-1',
        contextEpoch: 0,
        parentRunId: 'run-active',
        disposition: 'steered',
        prompt: {
          id: 'background-result-admission-shell-1',
          sessionId: 'session-1',
          contextEpoch: 0,
          mode: 'steer',
          status: 'running',
          runMode: 'agent',
          sourceMessageId: 'background-result-source-shell-1',
          assistantMessageId: 'background-result-assistant-shell-1',
          messages: [{ role: 'user', content: 'shell result' }],
          createdAt: 1,
          updatedAt: 1
        }
      },
      'assistant-active'
    )

    expect(next.messages.map((message) => message.id)).toEqual([
      'user-active',
      'background-result-source-shell-1',
      'assistant-active'
    ])
    expect(next.messages[1]).toMatchObject({ isInternal: true, content: 'shell result' })
    expect(next.resources).toContainEqual(
      expect.objectContaining({
        id: '11111111111111111111111111111111',
        kind: 'terminal',
        runIds: ['run-active']
      })
    )
  })

  it('routes detached subagent progress to the parent message after its run stream ends', () => {
    const withStart = applyBackgroundSubagentEventNotification(baseSession(), {
      jobId: 'job-live',
      sessionId: 'session-1',
      contextEpoch: 0,
      parentRunId: 'run-active',
      parentAssistantMessageId: 'assistant-active',
      event: {
        type: 'subagent_start',
        subagentId: 'subagent-live',
        parentToolCallId: 'call-live',
        label: 'Research',
        task: 'Inspect',
        maxSteps: 4
      }
    })
    const withDelta = applyBackgroundSubagentEventNotification(withStart, {
      jobId: 'job-live',
      sessionId: 'session-1',
      contextEpoch: 0,
      parentRunId: 'run-active',
      parentAssistantMessageId: 'assistant-active',
      event: {
        type: 'subagent_event',
        subagentId: 'subagent-live',
        event: {
          type: 'agent_message_delta',
          content: 'Still streaming',
          step: 1,
          stepId: 'subagent-live:step:1'
        }
      }
    })

    expect(withDelta.messages[1].agentEvents).toMatchObject([
      { type: 'subagent_start', subagentId: 'subagent-live' },
      {
        type: 'subagent_event',
        subagentId: 'subagent-live',
        event: { type: 'agent_message_delta', content: 'Still streaming' }
      }
    ])
  })

  it('prefers the explicit parent message when an older run reused a subagent id', () => {
    const source: Session = {
      ...baseSession(),
      messages: [
        {
          id: 'assistant-old',
          role: 'assistant',
          content: 'old',
          agentEvents: [
            {
              type: 'subagent_start',
              subagentId: 'subagent-reused',
              parentToolCallId: 'call-old',
              label: 'Research',
              task: 'Old task',
              maxSteps: 4
            }
          ]
        },
        ...baseSession().messages
      ]
    }
    const next = applyBackgroundSubagentEventNotification(source, {
      jobId: 'job-new',
      sessionId: 'session-1',
      contextEpoch: 0,
      parentRunId: 'run-active',
      parentAssistantMessageId: 'assistant-active',
      event: {
        type: 'subagent_end',
        subagentId: 'subagent-reused',
        status: 'completed',
        finalAnswer: 'new result'
      }
    })

    expect(next.messages[0].agentEvents).toHaveLength(1)
    expect(next.messages[2].agentEvents).toContainEqual(
      expect.objectContaining({ type: 'subagent_end', finalAnswer: 'new result' })
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

describe('applySteeredAdmission', () => {
  const withQueuedPair = (): Session[] => [
    {
      id: 'session-1',
      title: 'Session',
      messages: [
        { id: 'user-active', role: 'user', content: 'active prompt' },
        { id: 'assistant-active', role: 'assistant', content: 'partial' },
        {
          id: 'user-queued',
          role: 'user',
          content: 'steer',
          queuedPrompt: {
            admissionId: 'admission-steer',
            sessionId: 'session-1',
            assistantMessageId: 'assistant-queued'
          }
        },
        { id: 'assistant-queued', role: 'assistant', content: '⏳ 已加入队列' }
      ]
    },
    { id: 'session-2', title: 'Other', messages: [] }
  ]

  it('moves the steered prompt above the active answer and drops its placeholder', () => {
    const next = applySteeredAdmission(withQueuedPair(), {
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      queuedAssistantMessageId: 'assistant-queued',
      activeAssistantMessageId: 'assistant-active'
    })

    expect(next[0].messages.map((m) => m.id)).toEqual([
      'user-active',
      'user-queued',
      'assistant-active'
    ])
    expect(next[0].messages.find((m) => m.id === 'user-queued')?.queuedPrompt).toBeUndefined()
  })

  it('only drops the placeholder when there is no active answer to anchor to', () => {
    const next = applySteeredAdmission(withQueuedPair(), {
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      queuedAssistantMessageId: 'assistant-queued'
    })

    expect(next[0].messages.map((m) => m.id)).toEqual([
      'user-active',
      'assistant-active',
      'user-queued'
    ])
    expect(next[0].messages.find((m) => m.id === 'user-queued')?.queuedPrompt).toBeUndefined()
  })

  it('leaves other sessions untouched', () => {
    const sessions = withQueuedPair()
    const next = applySteeredAdmission(sessions, {
      sessionId: 'session-1',
      sourceMessageId: 'user-queued',
      queuedAssistantMessageId: 'assistant-queued',
      activeAssistantMessageId: 'assistant-active'
    })
    expect(next[1]).toBe(sessions[1])
  })
})
