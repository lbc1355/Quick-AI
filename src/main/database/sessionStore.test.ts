import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { Session } from '../../shared/types'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import {
  computeSessionHash,
  listSessionFileRestorePoints,
  planSessionPersist
} from './sessionStore'
import { closeDb, loadSessions, saveSessions } from '../database'
import { getDb } from './connection'

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

    const advanced = makeSession('a', { contextEpoch: 1 })
    expect(computeSessionHash(advanced)).not.toBe(computeSessionHash(a))

    const manuallyRenamed = makeSession('a', { titleManuallyEdited: true })
    expect(computeSessionHash(manuallyRenamed)).not.toBe(computeSessionHash(a))

    const reasoningChanged = makeSession('a', { reasoningPreference: 'high' })
    expect(computeSessionHash(reasoningChanged)).not.toBe(computeSessionHash(a))

    const reverted = makeSession('a', {
      revert: {
        boundaryMessageId: 'a-m1',
        revertedMessages: [{ id: 'a-m2', role: 'assistant', content: 'hidden' }],
        runIds: [],
        revertedAt: 10
      }
    })
    expect(computeSessionHash(reverted)).not.toBe(computeSessionHash(a))
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
    const sessions = [
      makeSession('a', { contextEpoch: 3, titleManuallyEdited: true }),
      makeSession('b')
    ]
    saveSessions(sessions)
    closeDb()
    const loaded = loadSessions()
    expect(loaded.map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(loaded.find((s) => s.id === 'a')?.contextEpoch).toBe(3)
    expect(loaded.find((s) => s.id === 'a')?.titleManuallyEdited).toBe(true)
    expect(loaded.find((s) => s.id === 'b')?.contextEpoch).toBe(0)
    expect(loaded.find((s) => s.id === 'b')?.titleManuallyEdited).toBeUndefined()
  })

  it('round-trips per-session reasoning preferences independently', () => {
    saveSessions([
      makeSession('a', { reasoningPreference: 'high' }),
      makeSession('b', { reasoningPreference: 'off' })
    ])
    closeDb()
    const loaded = loadSessions()
    expect(loaded.find((s) => s.id === 'a')?.reasoningPreference).toBe('high')
    expect(loaded.find((s) => s.id === 'b')?.reasoningPreference).toBe('off')
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

  it('removes prompt-inbox and background-job rows when a session is deleted', () => {
    const database = getDb()
    saveSessions([makeSession('b')])

    // Seed rows that have no FK cascade and would otherwise be orphaned by the delete.
    database
      .prepare(
        `INSERT INTO session_prompt_inbox (id, sessionId, contextEpoch, mode, status, runMode, sourceMessageId, messages, createdAt, updatedAt)
         VALUES (?, ?, 0, 'steer', 'pending', 'chat', 'src-1', '[]', 1, 1)`
      )
      .run('inbox-1', 'b')
    database
      .prepare(
        `INSERT INTO background_jobs (id, type, title, sessionId, status, createdAt, updatedAt)
         VALUES (?, 'shell', 'title', ?, 'running', 1, 1)`
      )
      .run('job-1', 'b')

    // Drop session 'b' from the snapshot — its scoped rows must go with it.
    saveSessions([])

    const inboxCount = database
      .prepare('SELECT COUNT(*) as c FROM session_prompt_inbox WHERE sessionId = ?')
      .get('b') as { c: number }
    const jobCount = database
      .prepare('SELECT COUNT(*) as c FROM background_jobs WHERE sessionId = ?')
      .get('b') as { c: number }
    expect(inboxCount.c).toBe(0)
    expect(jobCount.c).toBe(0)
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

  it('round-trips message errorPayload', () => {
    const errorPayload = {
      message: 'DNS lookup failed',
      category: 'network' as const,
      source: 'model_api' as const,
      rawError: 'Error: getaddrinfo ENOTFOUND api.deepseek.com',
      timestamp: 123456789
    }
    const session = makeSession('err-session', {
      messages: [
        {
          id: 'err-m1',
          role: 'assistant',
          content: 'Failed to fetch',
          isRuntimeError: true,
          errorPayload
        }
      ]
    })
    saveSessions([session])
    closeDb()

    const loaded = loadSessions()
    const found = loaded.find((s) => s.id === 'err-session')
    expect(found).toBeDefined()
    expect(found!.messages).toHaveLength(1)
    expect(found!.messages[0].errorPayload).toEqual(errorPayload)
  })

  it('round-trips a staged session rollback with recoverable messages', () => {
    const session = makeSession('reverted', {
      contextEpoch: 2,
      revert: {
        boundaryMessageId: 'reverted-m1',
        revertedMessages: [
          { id: 'reverted-m2', role: 'assistant', content: 'recover me', agentRunId: 'run-2' }
        ],
        runIds: ['run-2'],
        fileRestorePoint: {
          projectRoot: 'D:\\project',
          tree: 'a'.repeat(40),
          paths: ['file.txt']
        },
        revertedAt: 123
      }
    })
    saveSessions([session])
    closeDb()

    expect(loadSessions()[0].revert).toEqual(session.revert)
    expect(listSessionFileRestorePoints()).toEqual([
      {
        sessionId: 'reverted',
        restorePoint: session.revert?.fileRestorePoint
      }
    ])
  })
})
