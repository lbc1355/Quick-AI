import { it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import { createStartupBackup, restoreLatestBackupIfNeeded } from './backup'

let dataDir: string
let db: Database.Database

const openDb = (dir: string): Database.Database => {
  const database = new Database(join(dir, 'quickai.db'))
  database.pragma('journal_mode = WAL')
  database.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, value TEXT)')
  return database
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'quickai-backup-'))
  db = openDb(dataDir)
})

afterEach(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describeWithSqlite('database startup backup', () => {
  it('writes a daily backup snapshot on first run', () => {
    const result = createStartupBackup(db, dataDir, { now: () => new Date('2026-08-14T10:00:00') })

    expect(result.performed).toBe(true)
    expect(result.backupPath).toContain('quickai-backup-2026-08-14')
    expect(existsSync(result.backupPath as string)).toBe(true)

    const snapshot = new Database(result.backupPath as string)
    expect(snapshot.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 })
    snapshot.close()
  })

  it('skips when the same daily slot already exists', () => {
    const now = (): Date => new Date('2026-08-14T10:00:00')
    createStartupBackup(db, dataDir, { now })

    const second = createStartupBackup(db, dataDir, { now })
    expect(second.performed).toBe(false)
    expect(second.reason).toBe('already-backed-up-today')
  })

  it('keeps only the newest rotating snapshots in minimal mode', () => {
    for (const minute of [10, 11, 12, 13, 14, 15]) {
      createStartupBackup(db, dataDir, {
        now: (): Date => new Date(`2026-08-14T10:${String(minute).padStart(2, '0')}:00`)
      })
    }

    const backups = join(dataDir, 'backups')
    const names = readdirSync(backups)
      .filter((n) => n.includes('-m'))
      .sort()
    expect(names.length).toBe(3)
    expect(names[names.length - 1]).toContain(
      `-m${Math.floor(new Date('2026-08-14T10:15:00').getTime() / 60_000)}`
    )
  })

  it('captures committed data in the snapshot', () => {
    db.prepare('INSERT INTO t (value) VALUES (?)').run('hello')
    const result = createStartupBackup(db, dataDir, { now: () => new Date('2026-08-14T10:00:00') })

    const snapshot = new Database(result.backupPath as string)
    expect(snapshot.prepare('SELECT value FROM t').get()).toEqual({ value: 'hello' })
    snapshot.close()
  })

  it('returns db-not-initialized when quickai.db is absent', () => {
    rmSync(join(dataDir, 'quickai.db'))
    db.close()
    const freshDir = mkdtempSync(join(tmpdir(), 'quickai-backup-none-'))
    try {
      const empty = new Database(':memory:')
      const result = createStartupBackup(empty as unknown as Database.Database, freshDir)
      expect(result.performed).toBe(false)
      expect(result.reason).toBe('db-not-initialized')
      empty.close()
    } finally {
      rmSync(freshDir, { recursive: true, force: true })
    }
  })
})

describeWithSqlite('restoreLatestBackupIfNeeded', () => {
  it('restores the newest backup when the main db is missing', () => {
    const now = (): Date => new Date('2026-08-14T10:00:00')
    db.prepare('INSERT INTO t (value) VALUES (?)').run('important')
    createStartupBackup(db, dataDir, { now })

    db.close()
    rmSync(join(dataDir, 'quickai.db'))
    rmSync(join(dataDir, 'quickai.db-wal'), { force: true })
    rmSync(join(dataDir, 'quickai.db-shm'), { force: true })

    expect(restoreLatestBackupIfNeeded(dataDir)).toBe(true)

    const recovered = openDb(dataDir)
    expect(recovered.prepare('SELECT value FROM t').get()).toEqual({ value: 'important' })
    recovered.close()
  })

  it('does nothing when the main db still exists', () => {
    createStartupBackup(db, dataDir, { now: () => new Date('2026-08-14T10:00:00') })
    expect(restoreLatestBackupIfNeeded(dataDir)).toBe(false)
  })

  it('does nothing when there are no backups at all', () => {
    db.close()
    rmSync(join(dataDir, 'quickai.db'), { force: true })
    rmSync(join(dataDir, 'quickai.db-wal'), { force: true })
    rmSync(join(dataDir, 'quickai.db-shm'), { force: true })
    expect(restoreLatestBackupIfNeeded(dataDir)).toBe(false)
  })
})
