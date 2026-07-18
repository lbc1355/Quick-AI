import { describe, expect, it } from 'vitest'
import type { AgentEventJournalSnapshot } from './agentEventJournal'
import { mergeAgentEventJournalsIntoSessions } from './agentEventRecovery'
import type { Session } from '../../shared/types'

const makeJournal = (
  overrides: Partial<AgentEventJournalSnapshot> = {}
): AgentEventJournalSnapshot => ({
  version: 1,
  runId: 'run-1',
  sessionId: 'session-1',
  assistantMessageId: 'assistant-1',
  status: 'completed',
  events: [
    { type: 'agent_start', skillName: 'General Agent', runId: 'run-1', sequence: 1 },
    { type: 'reasoning', content: 'thinking', runId: 'run-1', sequence: 2 },
    { type: 'final', content: 'Recovered answer', runId: 'run-1', sequence: 3 },
    { type: 'agent_end', status: 'completed', runId: 'run-1', sequence: 4 }
  ],
  lastSequence: 4,
  startedAt: 1,
  updatedAt: 2,
  completedAt: 2,
  ...overrides
})

const makeSession = (): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: [
    { id: 'user-1', role: 'user', content: 'Question' },
    { id: 'assistant-1', role: 'assistant', content: '', agentRunId: 'run-1', agentEvents: [] }
  ]
})

describe('mergeAgentEventJournalsIntoSessions', () => {
  it('replays final content, reasoning, and timeline into the assistant placeholder', () => {
    const [session] = mergeAgentEventJournalsIntoSessions([makeSession()], [makeJournal()])
    const assistant = session.messages[1]

    expect(assistant).toMatchObject({
      id: 'assistant-1',
      agentRunId: 'run-1',
      agentRunIds: ['run-1'],
      content: 'Recovered answer',
      reasoning_content: 'thinking'
    })
    expect(assistant.agentEvents?.at(-1)).toMatchObject({
      type: 'agent_end',
      status: 'completed'
    })
  })

  it('replaces duplicate events for the same run instead of appending them twice', () => {
    const session = makeSession()
    session.messages[1].agentEvents = [
      { type: 'agent_start', skillName: 'General Agent', runId: 'run-1', sequence: 1 }
    ]

    const [merged] = mergeAgentEventJournalsIntoSessions([session], [makeJournal()])
    expect(
      merged.messages[1].agentEvents?.filter((event) => event.type === 'agent_start')
    ).toHaveLength(1)
  })

  it('preserves older run events when an inline resume reuses the assistant message', () => {
    const session = makeSession()
    session.messages[1] = {
      ...session.messages[1],
      agentRunId: 'run-2',
      agentRunIds: ['run-1', 'run-2'],
      agentEvents: [
        { type: 'tool_call', callId: 'old-call', toolName: 'file_read', args: {}, runId: 'run-1' }
      ]
    }
    const resumed = makeJournal({
      runId: 'run-2',
      status: 'interrupted',
      events: [
        { type: 'agent_start', skillName: 'General Agent', runId: 'run-2', sequence: 1 },
        {
          type: 'agent_end',
          status: 'failed',
          error: 'Agent run was interrupted',
          runId: 'run-2',
          sequence: 2
        }
      ],
      lastSequence: 2
    })

    const [merged] = mergeAgentEventJournalsIntoSessions([session], [resumed])
    expect(merged.messages[1].agentEvents).toEqual([
      expect.objectContaining({ type: 'tool_call', runId: 'run-1' }),
      expect.objectContaining({ type: 'agent_start', runId: 'run-2' }),
      expect.objectContaining({ type: 'agent_end', status: 'failed', runId: 'run-2' })
    ])
  })

  it('ignores journals whose assistant message no longer exists', () => {
    const sessions = [makeSession()]
    const result = mergeAgentEventJournalsIntoSessions(sessions, [
      makeJournal({ assistantMessageId: 'missing-message' })
    ])
    expect(result).toEqual(sessions)
  })
})
