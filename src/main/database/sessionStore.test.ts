import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { Session } from '../../shared/types'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import { computeSessionHash, planSessionPersist } from './sessionStore'
import { closeDb, loadSessions, saveSessions } from '../database'

const testDir = join(__dirname, '../../../temp-session-store-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

const makeSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  title: `session ${id}`,
  lastActiveTime: 1,
  messages: [{ id: `${id}-m1`, role: 'user', content: `hello from ${id}` }],
  ...overrides
})

describe('planSessionPersist / computeSessionHash', () => {
  it('hashes identical sessions identically and reacts to real changes', () => {
    const a = makeSession('a')
    const b = makeSession('a')
    expect(computeSessionHash(a)).toBe(computeSessionHash(b))

    const changed = makeSession('a', {
      messages: [{ id: 'a-m1', role: 'user', content: 'different' }]
    })
    expect(computeSessionHash(changed)).not.toBe(computeSessionHash(a))

    const touched = makeSession('a', { lastActiveTime: 999 })
    expect(computeSessionHash(touched)).not.toBe(computeSessionHash(a))
  })

  it('treats missing and falsy-optional fields as canonically equal', () => {
    const withUndefined = makeSession('a', { projectId: undefined, branchOf: undefined })
    const bare: Session = {
      id: 'a',
      title: 'session a',
      lastActiveTime: 1,
      messages: [{ id: 'a-m1', role: 'user', content: 'hello from a' }]
    }
    expect(computeSessionHash(withUndefined)).toBe(computeSessionHash(bare))
  })

  it('flags new and changed sessions for upsert and absent ids for deletion', () => {
    const unchanged = makeSession('keep')
    const changed = makeSession('edit', { title: 'edited title' })
    const added = makeSession('new')

    const existing = new Map<string, string | null>([
      ['keep', computeSessionHash(unchanged)],
      ['edit', computeSessionHash(makeSession('edit'))],
      ['gone', 'some-old-hash']
    ])

    const plan = planSessionPersist(existing, [unchanged, changed, added])

    const upsertIds = plan.upserts.map((u) => u.session.id).sort()
    expect(upsertIds).toEqual(['edit', 'new'])
    expect(plan.deleteIds).toEqual(['gone'])
  })

  it('produces an empty plan when nothing changed', () => {
    const s = makeSession('a')
    const existing = new Map<string, string | null>([['a', computeSessionHash(s)]])
    const plan = planSessionPersist(existing, [s])
    expect(plan.upserts).toHaveLength(0)
    expect(plan.deleteIds).toHaveLength(0)
  })
})

describeWithSqlite('saveSessions incremental persistence', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('round-trips a multi-session snapshot', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    saveSessions(sessions)
    closeDb()
    const loaded = loadSessions()
    expect(loaded.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('keeps untouched sessions intact when only one session changes', () => {
    saveSessions([makeSession('a'), makeSession('b')])

    const edited = makeSession('a', {
      lastActiveTime: 5,
      messages: [
        { id: 'a-m1', role: 'user', content: 'hello from a' },
        { id: 'a-m2', role: 'assistant', content: 'reply' }
      ]
    })
    saveSessions([edited, makeSession('b')])
    closeDb()

    const loaded = loadSessions()
    const a = loaded.find((s) => s.id === 'a')
    const b = loaded.find((s) => s.id === 'b')
    expect(a?.messages).toHaveLength(2)
    expect(b?.messages).toHaveLength(1)
    expect(b?.messages[0].content).toBe('hello from b')
  })

  it('deletes sessions removed from the snapshot (and cascades their messages)', () => {
    saveSessions([makeSession('a'), makeSession('b')])

    saveSessions([makeSession('a')])
    closeDb()

    const loaded = loadSessions()
    expect(loaded.map((s) => s.id)).toEqual(['a'])
  })

  it('is idempotent: re-saving the same snapshot preserves data', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    saveSessions(sessions)
    saveSessions(sessions)
    closeDb()

    const loaded = loadSessions()
    expect(loaded.map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(loaded.find((s) => s.id === 'a')?.messages).toHaveLength(1)
  })

  it('rewrites message files when a session changes', () => {
    saveSessions([
      makeSession('a', {
        messages: [
          {
            id: 'a-m1',
            role: 'user',
            content: 'with file',
            files: [{ name: 'a.txt', content: 'AAA', type: 'text' }]
          }
        ]
      })
    ])

    saveSessions([
      makeSession('a', {
        lastActiveTime: 2,
        messages: [
          {
            id: 'a-m1',
            role: 'user',
            content: 'with file',
            files: [{ name: 'b.txt', content: 'BBB', type: 'text' }]
          }
        ]
      })
    ])
    closeDb()

    const files = loadSessions().find((s) => s.id === 'a')?.messages[0].files
    expect(files).toEqual([{ name: 'b.txt', content: 'BBB', type: 'text' }])
  })
})
