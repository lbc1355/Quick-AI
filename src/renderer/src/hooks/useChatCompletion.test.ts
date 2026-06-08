import { describe, it, expect } from 'vitest'
import {
  createForkedSession,
  forkResourcesForRuns,
  getRunIdsThroughMessage,
  isRuntimeErrorAssistantMessage,
  mergeResourceUpdate,
  touchSessionInSnapshot
} from './useChatCompletion'
import { Message, Session, SessionResource } from '../../../shared/types'

function res(over: Partial<SessionResource> = {}): SessionResource {
  return {
    id: 'r1',
    kind: 'web',
    source: 'https://example.com/r1',
    status: 'partial',
    chunks: [],
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

describe('mergeResourceUpdate', () => {
  it('stamps the run id on a brand-new resource', () => {
    const out = mergeResourceUpdate(undefined, res({ id: 'r1' }), 'runA')
    expect(out.id).toBe('r1')
    expect(out.runIds).toEqual(['runA'])
  })

  it('does not duplicate a run id already present', () => {
    const existing = res({ runIds: ['runA'] })
    const out = mergeResourceUpdate(existing, res(), 'runA')
    expect(out.runIds).toEqual(['runA'])
  })

  it('accumulates run ids across turns', () => {
    const existing = res({ runIds: ['runA'] })
    const out = mergeResourceUpdate(existing, res(), 'runB')
    expect(out.runIds).toEqual(['runA', 'runB'])
  })

  it('merges chunks and fetched ranges while stamping the run', () => {
    const existing = res({
      runIds: ['runA'],
      fetchedRanges: [{ start: 0, end: 100 }],
      chunks: [{ id: 'c0', offset: 0, endOffset: 100, createdAt: 1 }]
    })
    const incoming = res({
      fetchedRanges: [{ start: 100, end: 200 }],
      chunks: [{ id: 'c1', offset: 100, endOffset: 200, createdAt: 2 }],
      nextOffset: 200,
      updatedAt: 5
    })
    const out = mergeResourceUpdate(existing, incoming, 'runB')

    expect(out.chunks.map((c) => c.id)).toEqual(['c0', 'c1'])
    // Adjacent ranges merge into one.
    expect(out.fetchedRanges).toEqual([{ start: 0, end: 200 }])
    expect(out.nextOffset).toBe(200)
    expect(out.runIds).toEqual(['runA', 'runB'])
  })
})

describe('isRuntimeErrorAssistantMessage', () => {
  it('recognizes explicitly-marked runtime errors', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'temporary provider error',
      isRuntimeError: true
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(true)
  })

  it('recognizes older API error messages by prefix', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Agent resume failed: API Error: 429 - insufficient quota'
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(true)
  })

  it('does not hide normal assistant content', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Here is the result of the task.'
    }

    expect(isRuntimeErrorAssistantMessage(msg)).toBe(false)
  })
})

describe('branch fork helpers', () => {
  it('collects assistant run ids through a historical message index', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'one' },
      { id: 'a1', role: 'assistant', content: 'one', agentRunId: 'run-1' },
      { id: 'u2', role: 'user', content: 'two' },
      { id: 'a2', role: 'assistant', content: 'two', agentRunId: 'run-2' }
    ]

    expect(getRunIdsThroughMessage(messages, 2)).toEqual(['run-1'])
  })

  it('keeps only resource run ids that belong to the forked history', () => {
    const forked = forkResourcesForRuns(
      [
        res({ id: 'legacy' }),
        res({ id: 'old', runIds: ['run-1'] }),
        res({ id: 'mixed', runIds: ['run-1', 'run-2'] }),
        res({ id: 'future', runIds: ['run-2'] })
      ],
      ['run-1']
    )

    expect(forked.map((r) => r.id)).toEqual(['legacy', 'old', 'mixed'])
    expect(forked.find((r) => r.id === 'mixed')?.runIds).toEqual(['run-1'])
  })

  it('creates a branch session through a source message without mutating the source session', () => {
    const source: Session = {
      id: 'source',
      title: 'Original',
      messages: [
        { id: 'u1', role: 'user', content: 'one' },
        { id: 'a1', role: 'assistant', content: 'one', agentRunId: 'run-1' },
        { id: 'u2', role: 'user', content: 'two' },
        { id: 'a2', role: 'assistant', content: 'two', agentRunId: 'run-2' }
      ],
      resources: [res({ id: 'old', runIds: ['run-1'] }), res({ id: 'future', runIds: ['run-2'] })],
      lastActiveTime: 1
    }

    const forked = createForkedSession({
      sourceSession: source,
      throughIdx: 2,
      id: 'branch',
      now: 10,
      branchOf: { sessionId: 'source', messageId: 'u2' },
      transformMessage: (message, idx) =>
        idx === 2 ? { ...message, content: 'edited two' } : message
    })

    expect(source.messages[2].content).toBe('two')
    expect(forked).toMatchObject({
      id: 'branch',
      title: 'Original 分支',
      lastActiveTime: 10,
      branchOf: { sessionId: 'source', messageId: 'u2' }
    })
    expect(forked.messages.map((m) => m.content)).toEqual(['one', 'one', 'edited two'])
    expect(forked.resources?.map((r) => r.id)).toEqual(['old'])
  })
})

describe('touchSessionInSnapshot', () => {
  it('updates one session timestamp without dropping branch metadata from other sessions', () => {
    const sessions: Session[] = [
      {
        id: 'source',
        title: 'Source',
        messages: [],
        lastActiveTime: 1
      },
      {
        id: 'branch',
        title: 'Branch',
        messages: [],
        lastActiveTime: 2,
        branchOf: { sessionId: 'source', messageId: 'm1', runId: 'run-1' }
      }
    ]

    const touched = touchSessionInSnapshot(sessions, 'source', 10)

    expect(touched.find((session) => session.id === 'source')?.lastActiveTime).toBe(10)
    expect(touched.find((session) => session.id === 'branch')?.branchOf).toEqual({
      sessionId: 'source',
      messageId: 'm1',
      runId: 'run-1'
    })
  })
})
