import { describe, expect, it } from 'vitest'
import type { Session, SessionResource } from '../../../../shared/types'
import {
  cloneSessionInSnapshot,
  cloneSessionsDeep,
  planRemovedRunCleanup,
  planStagedRevertCommit,
  replaceSessionInSnapshot,
  touchSessionInSnapshot
} from './sessionSnapshot'

const resource = (id: string, runIds: string[]): SessionResource => ({
  id,
  kind: 'web',
  source: `https://example.com/${id}`,
  status: 'complete',
  chunks: [],
  runIds,
  createdAt: 1,
  updatedAt: 1
})

const revertedSession = (over: Partial<Session> = {}): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: [{ id: 'kept', role: 'user', content: 'kept' }],
  resources: [resource('r-kept', ['run-kept'])],
  revert: {
    boundaryMessageId: 'boundary',
    revertedMessages: [{ id: 'boundary', role: 'user', content: 'undone' }],
    runIds: ['run-undone'],
    originalResources: [resource('r-kept', ['run-kept']), resource('r-undone', ['run-undone'])],
    revertedAt: 5
  },
  ...over
})

const clearedSession = (over: Partial<Session> = {}): Session => ({
  id: 'session-1',
  title: '新对话',
  messages: [],
  resources: [],
  clearedDraft: {
    messages: [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: 'hi', agentRunId: 'run-1' }
    ],
    resources: [resource('r-cleared', ['run-1'])],
    title: '原标题',
    clearedAt: 5
  },
  ...over
})

describe('cloneSessionsDeep', () => {
  it('detaches messages so a working copy can be mutated safely', () => {
    const source: Session[] = [
      { id: 's1', title: 'a', messages: [{ id: 'm1', role: 'user', content: 'hi' }] }
    ]
    const clone = cloneSessionsDeep(source)
    clone[0].messages.push({ id: 'm2', role: 'user', content: 'added' })
    clone[0].messages[0].content = 'changed'

    expect(source[0].messages).toHaveLength(1)
    expect(source[0].messages[0].content).toBe('hi')
  })
})

describe('cloneSessionInSnapshot', () => {
  it('clones only the session being mutated', () => {
    const target: Session = {
      id: 'target',
      title: 'Target',
      messages: [{ id: 'm1', role: 'user', content: 'hello' }]
    }
    const untouched: Session = {
      id: 'other',
      title: 'Other',
      messages: [{ id: 'm2', role: 'user', content: 'world' }]
    }

    const result = cloneSessionInSnapshot([target, untouched], 'target')

    expect(result[0]).not.toBe(target)
    expect(result[0].messages[0]).not.toBe(target.messages[0])
    expect(result[1]).toBe(untouched)
  })
})

describe('touchSessionInSnapshot', () => {
  it('stamps only the target session', () => {
    const sessions: Session[] = [
      { id: 's1', title: 'a', messages: [], lastActiveTime: 1 },
      { id: 's2', title: 'b', messages: [], lastActiveTime: 1 }
    ]
    const touched = touchSessionInSnapshot(sessions, 's2', 99)
    expect(touched[0].lastActiveTime).toBe(1)
    expect(touched[1].lastActiveTime).toBe(99)
  })
})

describe('replaceSessionInSnapshot', () => {
  it('substitutes by id and leaves the rest identical', () => {
    const a: Session = { id: 's1', title: 'a', messages: [] }
    const b: Session = { id: 's2', title: 'b', messages: [] }
    const next = replaceSessionInSnapshot([a, b], { ...b, title: 'renamed' })
    expect(next[0]).toBe(a)
    expect(next[1].title).toBe('renamed')
  })
})

describe('planRemovedRunCleanup', () => {
  const edited = (): Session => ({
    id: 'session-1',
    title: 'Session',
    messages: [],
    resources: [resource('r-kept', ['run-kept']), resource('r-dropped', ['run-dropped'])]
  })

  it('keeps resources belonging to surviving runs and deletes the rest', () => {
    const session = edited()
    const plan = planRemovedRunCleanup([session], session, ['run-dropped'])

    expect(plan.keptResources.map((r) => r.id)).toEqual(['r-kept'])
    expect(plan.cacheCleanup).toEqual({
      sessionIds: [],
      resourceIds: ['r-dropped'],
      partialActions: [{ sessionId: 'session-1', runIds: ['run-dropped'] }]
    })
  })

  it('spares a resource a sibling session still references', () => {
    const session = edited()
    const sibling: Session = {
      id: 'session-2',
      title: 'Branch',
      messages: [],
      resources: [resource('r-dropped', ['run-elsewhere'])]
    }
    const plan = planRemovedRunCleanup([session, sibling], session, ['run-dropped'])

    // The action log for the removed run still goes; only the shared cache row survives.
    expect(plan.cacheCleanup?.resourceIds).toEqual([])
    expect(plan.cacheCleanup?.partialActions).toEqual([
      { sessionId: 'session-1', runIds: ['run-dropped'] }
    ])
  })

  it('keeps a resource shared by a removed and a surviving run', () => {
    const session: Session = {
      id: 'session-1',
      title: 'Session',
      messages: [],
      resources: [resource('r-shared', ['run-dropped', 'run-kept'])]
    }
    const plan = planRemovedRunCleanup([session], session, ['run-dropped'])
    expect(plan.keptResources.map((r) => r.id)).toEqual(['r-shared'])
    expect(plan.cacheCleanup?.resourceIds).toEqual([])
  })

  it('plans nothing when no runs were removed', () => {
    const session = edited()
    expect(planRemovedRunCleanup([session], session, []).cacheCleanup).toBeUndefined()
  })
})

describe('planStagedRevertCommit', () => {
  it('is a no-op when nothing is staged', () => {
    const sessions: Session[] = [{ id: 's1', title: 'a', messages: [] }]
    const plan = planStagedRevertCommit(sessions, sessions[0])
    expect(plan.session).toBe(sessions[0])
    expect(plan.sessions).toBe(sessions)
    expect(plan.cacheCleanup).toBeUndefined()
  })

  it('drops the staged rollback and substitutes the committed session', () => {
    const session = revertedSession()
    const plan = planStagedRevertCommit([session], session)

    expect(plan.session.revert).toBeUndefined()
    expect(plan.sessions[0]).toBe(plan.session)
  })

  it('schedules the reverted runs and their orphaned resources for deletion', () => {
    const session = revertedSession()
    const plan = planStagedRevertCommit([session], session)

    expect(plan.cacheCleanup).toEqual({
      sessionIds: [],
      resourceIds: ['r-undone'],
      partialActions: [{ sessionId: 'session-1', runIds: ['run-undone'] }]
    })
  })

  it('keeps a resource another session still references', () => {
    const session = revertedSession()
    const sibling: Session = {
      id: 'session-2',
      title: 'Other',
      messages: [],
      resources: [resource('r-undone', ['run-elsewhere'])]
    }
    const plan = planStagedRevertCommit([session, sibling], session)

    expect(plan.cacheCleanup?.resourceIds).toEqual([])
    expect(plan.cacheCleanup?.partialActions).toEqual([
      { sessionId: 'session-1', runIds: ['run-undone'] }
    ])
  })

  it('omits the cleanup entirely when the rollback freed nothing', () => {
    const session = revertedSession({
      revert: {
        boundaryMessageId: 'boundary',
        revertedMessages: [],
        runIds: [],
        originalResources: [],
        revertedAt: 5
      },
      resources: []
    })
    const plan = planStagedRevertCommit([session], session)
    expect(plan.cacheCleanup).toBeUndefined()
  })

  it('does not mutate the input snapshot', () => {
    const session = revertedSession()
    const sessions = [session]
    planStagedRevertCommit(sessions, session)
    expect(sessions[0].revert).toBeDefined()
  })

  it('commits a staged /clear undo and schedules its orphaned resources for deletion', () => {
    const session = clearedSession()
    const plan = planStagedRevertCommit([session], session)

    expect(plan.session.clearedDraft).toBeUndefined()
    expect(plan.cacheCleanup).toEqual({
      sessionIds: [],
      resourceIds: ['r-cleared']
    })
  })

  it('keeps a cleared resource another session still references', () => {
    const session = clearedSession()
    const sibling: Session = {
      id: 'session-2',
      title: 'Other',
      messages: [],
      resources: [resource('r-cleared', ['run-elsewhere'])]
    }
    const plan = planStagedRevertCommit([session, sibling], session)

    expect(plan.cacheCleanup).toBeUndefined()
  })

  it('omits the cleanup when the cleared draft referenced nothing', () => {
    const session = clearedSession({
      clearedDraft: { messages: [], resources: [], title: '新对话', clearedAt: 5 }
    })
    const plan = planStagedRevertCommit([session], session)

    expect(plan.cacheCleanup).toBeUndefined()
  })

  it('does not mutate the input snapshot when committing a clear', () => {
    const session = clearedSession()
    const sessions = [session]
    planStagedRevertCommit(sessions, session)
    expect(sessions[0].clearedDraft).toBeDefined()
  })
})
