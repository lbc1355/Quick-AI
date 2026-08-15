import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'

const BACKUP_DIR_NAME = 'backups'
const BACKUP_FILE_PREFIX = 'quickai-backup-'
const BACKUP_FILE_SUFFIX = '.db'
const DB_FILE_NAME = 'quickai.db'
/** 30 MB — smaller snapshots are cheap enough to keep; larger ones only get the daily slot. */
const MINIMAL_MODE_SIZE_LIMIT = 30 * 1024 * 1024
/** Keep this many rotating backups in minimal mode, plus always the most recent daily one. */
const MINIMAL_MODE_KEEP = 3

export interface BackupResult {
  performed: boolean
  reason?: 'db-too-small' | 'db-not-initialized' | 'already-backed-up-today' | 'no-previous-backup'
  backupPath?: string
  previousBackupFound?: boolean
  previousBackupRestored?: boolean
  error?: Error
}

export interface BackupOptions {
  /** Test seam: inject a clock so tests don't depend on the wall date. */
  now?: () => Date
}

const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`

const getBackupDir = (dataDir: string): string => join(dataDir, BACKUP_DIR_NAME)

const listBackups = (backupDir: string): string[] => {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((name) => {
      if (!name.startsWith(BACKUP_FILE_PREFIX) || !name.endsWith(BACKUP_FILE_SUFFIX)) {
        return false
      }
      return statSync(join(backupDir, name)).isFile()
    })
    .sort()
}

/**
 * Copy the newest existing backup over a missing main database so the app can still
 * start. Only attempts recovery when the main db file does not exist; a present but
 * corrupt file is left untouched (SQLite surfaces that error instead of us silently
 * overwriting evidence).
 */
export const restoreLatestBackupIfNeeded = (dataDir: string): boolean => {
  const dbPath = join(dataDir, DB_FILE_NAME)
  if (existsSync(dbPath)) return false

  const backups = listBackups(getBackupDir(dataDir))
  if (backups.length === 0) return false

  cpSync(join(getBackupDir(dataDir), backups[backups.length - 1]), dbPath)
  return true
}

const newestBackupMtime = (backupDir: string): number | null => {
  const backups = listBackups(backupDir)
  if (backups.length === 0) return null
  return statSync(join(backupDir, backups[backups.length - 1])).mtimeMs
}

const pruneMinimalModeBackups = (backupDir: string, protectedName: string): void => {
  const rotating = listBackups(backupDir).filter((name) => name !== protectedName)
  const excess = rotating.length - MINIMAL_MODE_KEEP
  for (let i = 0; i < excess; i += 1) {
    rmSync(join(backupDir, rotating[i]))
  }
}

/**
 * Rolling startup backup.
 *
 * - One daily snapshot per calendar day (`quickai-backup-YYYY-MM-DD.db`).
 * - Databases under MINIMAL_MODE_SIZE_LIMIT additionally keep the most recent
 *   MINIMAL_MODE_KEEP minute-stamped snapshots, so a freshly corrupted db can be
 *   rolled back minutes rather than days.
 *
 * VACUUM INTO writes a consistent snapshot even while WAL commits are in flight.
 */
export const createStartupBackup = (
  db: Database.Database,
  dataDir: string,
  options: BackupOptions = {}
): BackupResult => {
  const now = options.now ?? ((): Date => new Date())
  const dbPath = join(dataDir, DB_FILE_NAME)
  const backupDir = getBackupDir(dataDir)

  if (!existsSync(dbPath)) {
    return { performed: false, reason: 'db-not-initialized' }
  }

  const dbSize = statSync(dbPath).size
  const today = formatDate(now())

  mkdirSync(backupDir, { recursive: true })
  const dailyPath = join(backupDir, `${BACKUP_FILE_PREFIX}${today}${BACKUP_FILE_SUFFIX}`)

  try {
    const previousMtime = newestBackupMtime(backupDir)

    if (dbSize <= MINIMAL_MODE_SIZE_LIMIT) {
      const stamp = Math.floor(now().getTime() / 60_000)
      const frequentPath = join(
        backupDir,
        `${BACKUP_FILE_PREFIX}${today}-m${stamp}${BACKUP_FILE_SUFFIX}`
      )
      if (!existsSync(frequentPath)) {
        db.exec(sqlitePathLiteral(frequentPath))
        pruneMinimalModeBackups(backupDir, dailyPath)
        return {
          performed: true,
          backupPath: frequentPath,
          previousBackupFound: previousMtime !== null
        }
      }
      return { performed: false, reason: 'already-backed-up-today' }
    }

    if (existsSync(dailyPath)) {
      return { performed: false, reason: 'already-backed-up-today', previousBackupFound: true }
    }

    db.exec(sqlitePathLiteral(dailyPath))
    return { performed: true, backupPath: dailyPath, previousBackupFound: previousMtime !== null }
  } catch (error) {
    return { performed: false, error: error as Error }
  }
}

const sqlitePathLiteral = (path: string): string => `VACUUM INTO '${path.replace(/'/g, "''")}'`
