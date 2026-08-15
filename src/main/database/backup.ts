import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { randomUUID } from 'crypto'

const BACKUP_DIR_NAME = 'backups'
const BACKUP_FILE_PREFIX = 'quickai-backup-'
const BACKUP_FILE_SUFFIX = '.db'
const DB_FILE_NAME = 'quickai.db'
/** Small databases additionally receive a rolling snapshot on every startup minute. */
const ROLLING_BACKUP_SIZE_LIMIT = 30 * 1024 * 1024
const ROLLING_BACKUP_KEEP = 3
const DAILY_BACKUP_KEEP = 7

const DAILY_BACKUP_PATTERN = /^quickai-backup-(\d{4}-\d{2}-\d{2})\.db$/
const ROLLING_BACKUP_PATTERN = /^quickai-backup-(\d{4}-\d{2}-\d{2})-m(\d+)\.db$/

type BackupKind = 'daily' | 'rolling'

interface BackupEntry {
  name: string
  path: string
  kind: BackupKind
  mtimeMs: number
}

export interface BackupResult {
  performed: boolean
  reason?: 'db-not-initialized' | 'already-backed-up-today' | 'already-backed-up-this-minute'
  backupPath?: string
  backupPaths?: string[]
  previousBackupFound?: boolean
  error?: Error
}

export interface RestoreResult {
  restored: boolean
  backupPath?: string
  error?: Error
}

export interface BackupOptions {
  /** Test seam: inject a clock so tests don't depend on the wall date. */
  now?: () => Date
  /** Test seam for exercising retention without loading the native SQLite binary. */
  databaseSize?: () => number
  /** The writer must create a complete SQLite snapshot at the supplied temporary path. */
  writeSnapshot?: (path: string) => void
  /** Test seam for restore fallback and atomic-copy behavior. */
  validateBackup?: (path: string) => boolean
}

export interface RestoreOptions {
  validateBackup?: (path: string) => boolean
}

const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`

const getBackupDir = (dataDir: string): string => join(dataDir, BACKUP_DIR_NAME)

const classifyBackup = (name: string): BackupKind | null => {
  if (DAILY_BACKUP_PATTERN.test(name)) return 'daily'
  if (ROLLING_BACKUP_PATTERN.test(name)) return 'rolling'
  return null
}

const listBackups = (backupDir: string): BackupEntry[] => {
  if (!existsSync(backupDir)) return []

  const entries: BackupEntry[] = []
  for (const name of readdirSync(backupDir)) {
    const kind = classifyBackup(name)
    if (!kind) continue
    const path = join(backupDir, name)
    const stat = statSync(path)
    if (!stat.isFile()) continue
    entries.push({ name, path, kind, mtimeMs: stat.mtimeMs })
  }
  return entries
}

const sortNewestFirst = (entries: readonly BackupEntry[]): BackupEntry[] =>
  [...entries].sort(
    (left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name)
  )

const validateSqliteBackup = (path: string): boolean => {
  let probe: Database.Database | null = null
  try {
    probe = new Database(path, { readonly: true, fileMustExist: true })
    return probe.pragma('quick_check', { simple: true }) === 'ok'
  } catch {
    return false
  } finally {
    probe?.close()
  }
}

const temporaryPathFor = (targetPath: string): string =>
  join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`)

const atomicCopy = (
  sourcePath: string,
  targetPath: string,
  validateBackup: (path: string) => boolean,
  beforeCommit?: () => void
): void => {
  const temporaryPath = temporaryPathFor(targetPath)
  try {
    copyFileSync(sourcePath, temporaryPath)
    if (!validateBackup(temporaryPath)) {
      throw new Error(`Backup copy failed integrity check: ${sourcePath}`)
    }
    beforeCommit?.()
    renameSync(temporaryPath, targetPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

const atomicSnapshot = (
  targetPath: string,
  writeSnapshot: (path: string) => void,
  validateBackup: (path: string) => boolean
): void => {
  const temporaryPath = temporaryPathFor(targetPath)
  try {
    writeSnapshot(temporaryPath)
    if (!validateBackup(temporaryPath)) {
      throw new Error(`New database backup failed integrity check: ${targetPath}`)
    }
    renameSync(temporaryPath, targetPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

const getDatabaseSize = (db: Database.Database): number => {
  const pageCount = Number(db.pragma('page_count', { simple: true }))
  const pageSize = Number(db.pragma('page_size', { simple: true }))
  if (!Number.isFinite(pageCount) || !Number.isFinite(pageSize)) {
    throw new Error('Unable to determine SQLite database size')
  }
  return pageCount * pageSize
}

const pruneBackups = (backupDir: string, kind: BackupKind, keep: number): void => {
  const entries = sortNewestFirst(listBackups(backupDir).filter((entry) => entry.kind === kind))
  for (const entry of entries.slice(keep)) {
    rmSync(entry.path)
  }
}

/**
 * Restore the newest valid snapshot over a missing main database. Candidates are tried by actual
 * modification time, not filename, and a corrupt newest snapshot falls back to the next one.
 * Copying goes through a validated temporary file so a failed restore never leaves quickai.db
 * half-written. Errors are returned to the caller instead of aborting application startup.
 */
export const restoreLatestBackupIfNeeded = (
  dataDir: string,
  options: RestoreOptions = {}
): RestoreResult => {
  const dbPath = join(dataDir, DB_FILE_NAME)
  if (existsSync(dbPath)) return { restored: false }

  const validateBackup = options.validateBackup || validateSqliteBackup
  let lastError: Error | undefined

  try {
    const backups = sortNewestFirst(listBackups(getBackupDir(dataDir)))
    for (const backup of backups) {
      try {
        if (!validateBackup(backup.path)) {
          lastError = new Error(`Backup failed integrity check: ${backup.path}`)
          continue
        }

        atomicCopy(backup.path, dbPath, validateBackup, () => {
          // Stale WAL sidecars belong to the missing database and must never be replayed onto the
          // restored snapshot. Remove them only after the replacement copy has been validated.
          rmSync(`${dbPath}-wal`, { force: true })
          rmSync(`${dbPath}-shm`, { force: true })
        })
        return { restored: true, backupPath: backup.path }
      } catch (error) {
        lastError = error as Error
        rmSync(dbPath, { force: true })
      }
    }
    return { restored: false, error: lastError }
  } catch (error) {
    return { restored: false, error: error as Error }
  }
}

/**
 * Create startup snapshots before schema/data migrations mutate the live database.
 *
 * - Keep one daily snapshot for the latest DAILY_BACKUP_KEEP days/startup dates.
 * - Databases up to ROLLING_BACKUP_SIZE_LIMIT also keep the latest
 *   ROLLING_BACKUP_KEEP minute-stamped startup snapshots.
 * - Snapshot and cleanup failures are reported without escaping into application startup.
 */
export const createStartupBackup = (
  db: Database.Database,
  dataDir: string,
  options: BackupOptions = {}
): BackupResult => {
  const dbPath = join(dataDir, DB_FILE_NAME)
  if (!existsSync(dbPath)) {
    return { performed: false, reason: 'db-not-initialized' }
  }

  const currentTime = (options.now || ((): Date => new Date()))()
  const backupDir = getBackupDir(dataDir)
  const today = formatDate(currentTime)
  const dailyPath = join(backupDir, `${BACKUP_FILE_PREFIX}${today}${BACKUP_FILE_SUFFIX}`)
  const rollingPath = join(
    backupDir,
    `${BACKUP_FILE_PREFIX}${today}-m${Math.floor(currentTime.getTime() / 60_000)}${BACKUP_FILE_SUFFIX}`
  )
  const writeSnapshot =
    options.writeSnapshot ||
    ((path: string): void => {
      db.exec(sqlitePathLiteral(path))
    })
  const validateBackup = options.validateBackup || validateSqliteBackup
  const createdPaths: string[] = []

  try {
    mkdirSync(backupDir, { recursive: true })
    const previousBackupFound = listBackups(backupDir).length > 0
    const databaseSize = (options.databaseSize || (() => getDatabaseSize(db)))()
    const useRollingBackup = databaseSize <= ROLLING_BACKUP_SIZE_LIMIT
    const needsDaily = !existsSync(dailyPath)
    const needsRolling = useRollingBackup && !existsSync(rollingPath)

    if (!needsDaily && !needsRolling) {
      return {
        performed: false,
        reason: useRollingBackup ? 'already-backed-up-this-minute' : 'already-backed-up-today',
        previousBackupFound
      }
    }

    if (needsRolling) {
      atomicSnapshot(rollingPath, writeSnapshot, validateBackup)
      createdPaths.push(rollingPath)
      if (needsDaily) {
        atomicCopy(rollingPath, dailyPath, validateBackup)
        createdPaths.push(dailyPath)
      }
    } else if (needsDaily) {
      atomicSnapshot(dailyPath, writeSnapshot, validateBackup)
      createdPaths.push(dailyPath)
    }

    pruneBackups(backupDir, 'rolling', ROLLING_BACKUP_KEEP)
    pruneBackups(backupDir, 'daily', DAILY_BACKUP_KEEP)

    return {
      performed: createdPaths.length > 0,
      backupPath: createdPaths[0],
      backupPaths: createdPaths,
      previousBackupFound
    }
  } catch (error) {
    return {
      performed: createdPaths.length > 0,
      backupPath: createdPaths[0],
      backupPaths: createdPaths,
      error: error as Error
    }
  }
}

const sqlitePathLiteral = (path: string): string => `VACUUM INTO '${path.replace(/'/g, "''")}'`
