import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import { createStartupBackup, restoreLatestBackupIfNeeded, type BackupOptions } from './backup'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'quickai-backup-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

const createLiveDatabasePlaceholder = (): void => {
  writeFileSync(join(dataDir, 'quickai.db'), 'live-database')
}

const fakeBackupOptions = (now: Date, databaseSize = 1024): BackupOptions => ({
  now: (): Date => now,
  databaseSize: (): number => databaseSize,
  writeSnapshot: (path: string): void => writeFileSync(path, `snapshot:${now.toISOString()}`),
  validateBackup: (path: string): boolean => readFileSync(path, 'utf8').startsWith('snapshot:')
})

const backupNames = (): string[] =>
  readdirSync(join(dataDir, 'backups'))
    .filter((name) => name.endsWith('.db'))
    .sort()

describe('database startup backup policy', () => {
  it('creates both a daily and rolling snapshot for a small existing database', () => {
    createLiveDatabasePlaceholder()
    const now = new Date('2026-08-14T10:00:00')

    const result = createStartupBackup({} as Database.Database, dataDir, fakeBackupOptions(now))

    expect(result.performed).toBe(true)
    expect(result.backupPaths).toHaveLength(2)
    expect(backupNames()).toEqual([
      `quickai-backup-2026-08-14-m${Math.floor(now.getTime() / 60_000)}.db`,
      'quickai-backup-2026-08-14.db'
    ])
  })

  it('deduplicates the same minute but still creates the next rolling snapshot', () => {
    createLiveDatabasePlaceholder()
    const first = new Date('2026-08-14T10:00:00')
    createStartupBackup({} as Database.Database, dataDir, fakeBackupOptions(first))

    const duplicate = createStartupBackup(
      {} as Database.Database,
      dataDir,
      fakeBackupOptions(first)
    )
    const nextMinute = createStartupBackup(
      {} as Database.Database,
      dataDir,
      fakeBackupOptions(new Date('2026-08-14T10:01:00'))
    )

    expect(duplicate).toMatchObject({
      performed: false,
      reason: 'already-backed-up-this-minute'
    })
    expect(nextMinute.performed).toBe(true)
    expect(nextMinute.backupPaths).toHaveLength(1)
  })

  it('keeps three rolling snapshots without deleting the daily snapshot', () => {
    createLiveDatabasePlaceholder()
    for (const minute of [10, 11, 12, 13, 14, 15]) {
      createStartupBackup(
        {} as Database.Database,
        dataDir,
        fakeBackupOptions(new Date(`2026-08-14T10:${minute}:00`))
      )
    }

    const names = backupNames()
    expect(names.filter((name) => name.includes('-m'))).toHaveLength(3)
    expect(names).toContain('quickai-backup-2026-08-14.db')
  })

  it('keeps only the seven newest daily snapshots for a large database', () => {
    createLiveDatabasePlaceholder()
    for (let day = 1; day <= 9; day += 1) {
      createStartupBackup(
        {} as Database.Database,
        dataDir,
        fakeBackupOptions(new Date(`2026-08-${String(day).padStart(2, '0')}T10:00:00`), 40_000_000)
      )
    }

    const names = backupNames()
    expect(names).toHaveLength(7)
    expect(names[0]).toBe('quickai-backup-2026-08-03.db')
    expect(names[names.length - 1]).toBe('quickai-backup-2026-08-09.db')
  })

  it('contains snapshot filesystem failures instead of throwing through startup', () => {
    createLiveDatabasePlaceholder()
    const options = fakeBackupOptions(new Date('2026-08-14T10:00:00'))

    const result = createStartupBackup({} as Database.Database, dataDir, {
      ...options,
      writeSnapshot: (path: string): void => {
        writeFileSync(path, 'partial')
        throw new Error('disk full')
      }
    })

    expect(result.performed).toBe(false)
    expect(result.error?.message).toBe('disk full')
    expect(readdirSync(join(dataDir, 'backups')).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('contains backup-directory failures instead of aborting startup', () => {
    createLiveDatabasePlaceholder()
    writeFileSync(join(dataDir, 'backups'), 'not-a-directory')

    const result = createStartupBackup(
      {} as Database.Database,
      dataDir,
      fakeBackupOptions(new Date('2026-08-14T10:00:00'))
    )

    expect(result.performed).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
  })

  it('reports an absent live database without creating a backup directory', () => {
    const result = createStartupBackup(
      {} as Database.Database,
      dataDir,
      fakeBackupOptions(new Date('2026-08-14T10:00:00'))
    )

    expect(result).toEqual({ performed: false, reason: 'db-not-initialized' })
    expect(existsSync(join(dataDir, 'backups'))).toBe(false)
  })
})

describe('restoreLatestBackupIfNeeded', () => {
  const validTextBackup = (path: string): boolean => readFileSync(path, 'utf8').startsWith('valid:')

  it('restores by modification time instead of lexicographic filename order', () => {
    const backups = join(dataDir, 'backups')
    mkdirSync(backups)
    const daily = join(backups, 'quickai-backup-2026-08-14.db')
    const rolling = join(backups, 'quickai-backup-2026-08-14-m100.db')
    writeFileSync(daily, 'valid:daily-old')
    writeFileSync(rolling, 'valid:rolling-new')
    utimesSync(daily, new Date('2026-08-14T10:00:00'), new Date('2026-08-14T10:00:00'))
    utimesSync(rolling, new Date('2026-08-14T11:00:00'), new Date('2026-08-14T11:00:00'))

    const result = restoreLatestBackupIfNeeded(dataDir, { validateBackup: validTextBackup })

    expect(result.restored).toBe(true)
    expect(result.backupPath).toBe(rolling)
    expect(readFileSync(join(dataDir, 'quickai.db'), 'utf8')).toBe('valid:rolling-new')
  })

  it('falls back to an older valid backup and removes stale WAL sidecars', () => {
    const backups = join(dataDir, 'backups')
    mkdirSync(backups)

    const good = join(backups, 'quickai-backup-2026-08-13.db')
    const bad = join(backups, 'quickai-backup-2026-08-14.db')
    writeFileSync(good, 'valid:older')
    writeFileSync(bad, 'corrupt:newer')
    utimesSync(good, new Date('2026-08-13T10:00:00'), new Date('2026-08-13T10:00:00'))
    utimesSync(bad, new Date('2026-08-14T10:00:00'), new Date('2026-08-14T10:00:00'))
    writeFileSync(join(dataDir, 'quickai.db-wal'), 'stale')
    writeFileSync(join(dataDir, 'quickai.db-shm'), 'stale')

    const result = restoreLatestBackupIfNeeded(dataDir, { validateBackup: validTextBackup })

    expect(result).toMatchObject({ restored: true, backupPath: good })
    expect(readFileSync(join(dataDir, 'quickai.db'), 'utf8')).toBe('valid:older')
    expect(existsSync(join(dataDir, 'quickai.db-wal'))).toBe(false)
    expect(existsSync(join(dataDir, 'quickai.db-shm'))).toBe(false)
  })

  it('does nothing when the live database exists or no backups are available', () => {
    createLiveDatabasePlaceholder()
    expect(restoreLatestBackupIfNeeded(dataDir, { validateBackup: validTextBackup })).toEqual({
      restored: false
    })

    rmSync(join(dataDir, 'quickai.db'))
    expect(restoreLatestBackupIfNeeded(dataDir, { validateBackup: validTextBackup })).toEqual({
      restored: false,
      error: undefined
    })
  })
})

describeWithSqlite('database backup SQLite integration', () => {
  it('captures committed WAL data in a valid snapshot', () => {
    const database = new Database(join(dataDir, 'quickai.db'))
    try {
      database.pragma('journal_mode = WAL')
      database.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)')
      database.prepare('INSERT INTO t (value) VALUES (?)').run('important')

      const result = createStartupBackup(database, dataDir, {
        now: () => new Date('2026-08-14T10:00:00')
      })
      const snapshot = new Database(result.backupPath as string)
      try {
        expect(snapshot.prepare('SELECT value FROM t').get()).toEqual({ value: 'important' })
      } finally {
        snapshot.close()
      }
    } finally {
      database.close()
    }
  })
})
