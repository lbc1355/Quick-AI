import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { StorageSchema } from '../../shared/types'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import { createSchema } from './schema'
import { migrateFromJson } from './migration'

/** Minimal but valid old-format store. UUID-ish message ids exercise the ordering path. */
const validStore = (): StorageSchema => ({
  settings: {
    providers: [],
    activeProviderId: '',
    systemPrompt: 'migration-test',
    autoHideOnBlur: true,
    theme: 'dark'
  },
  sessions: [
    {
      id: 'session-1',
      title: 'First Session',
      lastActiveTime: 1000,
      messages: [
        { id: 'msg-00000000-0000-0000-0000-000000000001', role: 'user', content: 'hello' },
        {
          id: 'msg-00000000-0000-0000-0000-000000000002',
          role: 'assistant',
          content: 'hi there',
          agentRunId: 'run-1',
          agentRunIds: ['run-1']
        },
        {
          id: 'msg-00000000-0000-0000-0000-000000000003',
          role: 'user',
          content: 'world',
          files: [{ name: 'a.txt', content: 'x', type: 'text/plain' }]
        }
      ]
    },
    {
      id: 'session-2',
      title: 'Second Session',
      lastActiveTime: 2000,
      messages: [
        { id: 'msg-2-1', role: 'user', content: 'again', isSynthetic: true, isInternal: true }
      ]
    }
  ],
  skills: [],
  projects: []
})

describeWithSqlite('migrateFromJson', () => {
  let db: Database.Database
  let dataDir: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    createSchema(db)
    dataDir = mkdtempSync(join(tmpdir(), 'quickai-migration-'))
  })

  afterEach(() => {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  const writeStore = (store: unknown): void => {
    writeFileSync(join(dataDir, 'quickai_store.json'), JSON.stringify(store))
  }

  it('migrates settings, sessions, messages, and files; renames the old store to .bak', () => {
    writeStore(validStore())
    migrateFromJson(db, dataDir)

    const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{
      key: string
      value: string
    }>
    expect(settings.some((s) => s.key === 'systemPrompt' && s.value === 'migration-test')).toBe(
      true
    )

    const sessions = db
      .prepare('SELECT id, title FROM sessions ORDER BY lastActiveTime')
      .all() as Array<{ id: string; title: string }>
    expect(sessions).toEqual([
      { id: 'session-1', title: 'First Session' },
      { id: 'session-2', title: 'Second Session' }
    ])

    const messages = db
      .prepare(
        'SELECT id, role, content, isSynthetic, isInternal FROM messages ORDER BY createdAt ASC'
      )
      .all()
    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({
      id: 'msg-00000000-0000-0000-0000-000000000001',
      role: 'user',
      content: 'hello'
    })
    expect(messages).toContainEqual({
      id: 'msg-2-1',
      role: 'user',
      content: 'again',
      isSynthetic: 1,
      isInternal: 1
    })

    const files = db.prepare('SELECT messageId, name, content, type FROM message_files').all()
    expect(files).toEqual([
      {
        messageId: 'msg-00000000-0000-0000-0000-000000000003',
        name: 'a.txt',
        content: 'x',
        type: 'text/plain'
      }
    ])

    expect(existsSync(join(dataDir, 'quickai_store.json.bak'))).toBe(true)
    expect(existsSync(join(dataDir, 'quickai_store.json'))).toBe(false)
  })

  it('is a no-op when settings already exist (already migrated)', () => {
    writeStore(validStore())
    migrateFromJson(db, dataDir)
    // Restore the source and run again — the count>0 guard must prevent re-import.
    renameSync(join(dataDir, 'quickai_store.json.bak'), join(dataDir, 'quickai_store.json'))
    migrateFromJson(db, dataDir)
    const sessions = db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    expect(sessions.c).toBe(2) // not duplicated to 4
  })

  it('preserves intra-session message order for UUID ids (monotonic createdAt)', () => {
    // Fix the clock so any buggy `Date.now()` fallback collapses all messages onto one value.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      writeStore(validStore())
      migrateFromJson(db, dataDir)
    } finally {
      vi.restoreAllMocks()
    }

    const rows = db
      .prepare('SELECT content, createdAt FROM messages WHERE sessionId = ? ORDER BY createdAt ASC')
      .all('session-1') as Array<{ content: string; createdAt: number }>
    expect(rows.map((r) => r.content)).toEqual(['hello', 'hi there', 'world'])
    expect(rows[0].createdAt).toBeLessThan(rows[1].createdAt)
    expect(rows[1].createdAt).toBeLessThan(rows[2].createdAt)
  })

  it('keeps a legacy numeric message id as its own timestamp', () => {
    const store = {
      ...validStore(),
      sessions: [
        { id: 's1', title: 't', messages: [{ id: '123456', role: 'user', content: 'legacy' }] }
      ]
    } as StorageSchema
    writeStore(store)
    migrateFromJson(db, dataDir)
    const row = db.prepare('SELECT createdAt FROM messages WHERE id = ?').get('123456') as {
      createdAt: number
    }
    expect(row.createdAt).toBe(123456)
  })

  it('rolls back a failed migration so a later retry can succeed', () => {
    // An object session id is not a valid SQLite bind value: the import fails mid-way, AFTER the
    // settings rows were already written. The whole store transaction must roll back so a later
    // retry is not permanently blocked by a half-written settings row.
    const badStore = {
      settings: { providers: [], activeProviderId: '', systemPrompt: 'x', autoHideOnBlur: true },
      sessions: [{ id: {}, title: 'broken', messages: [] }]
    } as unknown as StorageSchema
    writeStore(badStore)
    migrateFromJson(db, dataDir)

    // Everything rolled back: no settings, no .bak, source still present.
    const settings = db.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number }
    expect(settings.c).toBe(0)
    expect(existsSync(join(dataDir, 'quickai_store.json.bak'))).toBe(false)
    expect(existsSync(join(dataDir, 'quickai_store.json'))).toBe(true)

    // Retrying with a valid store must not be blocked by a half-written settings row.
    writeStore(validStore())
    migrateFromJson(db, dataDir)
    const sessions = db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    expect(sessions.c).toBe(2)
  })

  it('migrates resource cache files per file and leaves corrupt files behind', () => {
    const resourcesDir = join(dataDir, 'resources')
    mkdirSync(resourcesDir, { recursive: true })
    writeFileSync(
      join(resourcesDir, 'res-good.json'),
      JSON.stringify({
        id: 'res-1',
        kind: 'web',
        source: 'https://example.com',
        totalChars: 10,
        chunks: [{ id: 1, offset: 0, endOffset: 10, text: 'abc' }]
      })
    )
    writeFileSync(join(resourcesDir, 'res-corrupt.json'), '{not-json')

    migrateFromJson(db, dataDir)

    const cache = db.prepare('SELECT id, source FROM resource_cache').all() as Array<{
      id: string
      source: string
    }>
    expect(cache).toEqual([{ id: 'res-1', source: 'https://example.com' }])
    expect(existsSync(join(resourcesDir, 'res-good.json.bak'))).toBe(true)
    expect(existsSync(join(resourcesDir, 'res-corrupt.json'))).toBe(true)
    expect(existsSync(join(resourcesDir, 'res-corrupt.json.bak'))).toBe(false)
  })

  it('retries leftover resource files on a later launch after the store has migrated', () => {
    const resourcesDir = join(dataDir, 'resources')
    mkdirSync(resourcesDir, { recursive: true })
    writeFileSync(
      join(resourcesDir, 'res-good.json'),
      JSON.stringify({ id: 'res-1', kind: 'web', source: 'https://a.example', chunks: [] })
    )
    writeFileSync(join(resourcesDir, 'res-corrupt.json'), '{not-json')

    // First launch: the store migrates (settings written) and the good resource is consumed; the
    // corrupt file stays behind for a later retry.
    writeStore(validStore())
    migrateFromJson(db, dataDir)

    // Second launch: even though the store is already migrated, the leftover resource is retried
    // once it becomes parseable.
    writeFileSync(
      join(resourcesDir, 'res-corrupt.json'),
      JSON.stringify({ id: 'res-2', kind: 'web', source: 'https://b.example', chunks: [] })
    )
    migrateFromJson(db, dataDir)

    const ids = (db.prepare('SELECT id FROM resource_cache').all() as Array<{ id: string }>).map(
      (row) => row.id
    )
    expect(ids).toEqual(expect.arrayContaining(['res-1', 'res-2']))
    expect(existsSync(join(resourcesDir, 'res-corrupt.json.bak'))).toBe(true)
  })
})

it('does not abort database initialization when the legacy resources path is unreadable', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'quickai-migration-unreadable-'))
  writeFileSync(join(dataDir, 'resources'), 'not a directory')
  const database = {
    prepare: () => ({ get: () => ({ c: 0 }) })
  } as unknown as Database.Database
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  try {
    expect(() => migrateFromJson(database, dataDir)).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      '[database] Failed to migrate resources/:',
      expect.anything()
    )
  } finally {
    errorSpy.mockRestore()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
