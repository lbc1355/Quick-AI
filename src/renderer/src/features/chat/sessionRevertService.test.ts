import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../../../../shared/types'
import {
  collectMessageRunIds,
  commitSessionRevert,
  prepareSessionRevert,
  restoreSessionRevert
} from './sessionRevertService'

const messages: Message[] = [
  { id: 'user-1', role: 'user', content: 'first' },
  { id: 'assistant-1', role: 'assistant', content: 'one', agentRunId: 'run-1' },
  { id: 'user-2', role: 'user', content: 'second' },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: 'two',
    agentRunId: 'run-2',
    agentRunIds: ['run-2', 'run-2-resume'],
    agentEvents: [{ type: 'file_changes', files: [], revertedAt: 123 }]
  }
]

const makeSession = (): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: messages.map((message) => ({ ...message })),
  contextEpoch: 4,
  resources: [
    {
      id: 'resource-1',
      kind: 'web',
      source: 'https://example.com',
      status: 'complete',
      chunks: [],
      createdAt: 1,
      updatedAt: 1,
      runIds: ['run-2']
    }
  ]
})

describe('sessionRevertService', () => {
  it('collects primary and resumed run ids in message order', () => {
    expect(collectMessageRunIds(messages)).toEqual(['run-1', 'run-2', 'run-2-resume'])
  })

  it('stages and restores a rollback without losing trailing messages', () => {
    const staged = prepareSessionRevert({
      session: makeSession(),
      boundaryMessageId: 'user-2',
      keptResources: [],
      now: 100
    })

    expect(staged.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(staged.contextEpoch).toBe(5)
    expect(staged.resources).toEqual([])
    expect(staged.revert).toMatchObject({
      boundaryMessageId: 'user-2',
      runIds: ['run-2', 'run-2-resume'],
      revertedAt: 100
    })
    expect(staged.revert?.revertedMessages.map((message) => message.id)).toEqual([
      'user-2',
      'assistant-2'
    ])

    const restored = restoreSessionRevert(staged, 200)
    expect(restored.messages.map((message) => message.id)).toEqual(
      messages.map((message) => message.id)
    )
    expect(restored.contextEpoch).toBe(6)
    expect(restored.resources).toEqual(makeSession().resources)
    expect(restored.revert).toBeUndefined()
    expect(
      restored.messages[3].agentEvents?.find((event) => event.type === 'file_changes')
    ).toMatchObject({ revertedAt: undefined })
  })

  it('commits the staged rollback while returning caches that may be pruned', () => {
    const staged = prepareSessionRevert({
      session: makeSession(),
      boundaryMessageId: 'user-2',
      now: 100
    })
    const committed = commitSessionRevert(staged)
    expect(committed.session.revert).toBeUndefined()
    expect(committed.committedRunIds).toEqual(['run-2', 'run-2-resume'])
    expect(committed.originalResources).toEqual(makeSession().resources)
  })

  it('rejects assistant messages as rollback boundaries', () => {
    expect(() =>
      prepareSessionRevert({
        session: makeSession(),
        boundaryMessageId: 'assistant-1',
        now: 100
      })
    ).toThrow('Only user messages can be reverted')
  })
})
