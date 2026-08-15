import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'
import { createSchema } from './schema'
import { migrateFromJson } from './migration'
import { createStartupBackup, restoreLatestBackupIfNeeded } from './backup'
import { logger } from '../logger'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'quickai.db')
  const databaseExistedAtStartup = existsSync(dbPath)

  const restore = restoreLatestBackupIfNeeded(dataDir)
  if (restore.restored) {
    logger.warn(
      'Database',
      'quickai.db was missing; restored it from the newest backup. Recent data may be lost.'
    )
  } else if (restore.error) {
    logger.warn('Database', 'Database restore was skipped:', restore.error.message)
  }

  db = new Database(dbPath)

  // Snapshot an existing/restored database before journal-mode, schema, or legacy-data changes.
  // A brand-new database has no state to protect and is backed up on its next startup.
  if (databaseExistedAtStartup || restore.restored) {
    const backup = createStartupBackup(db, dataDir)
    if (backup.error) {
      logger.warn('Database', 'Startup backup was incomplete:', backup.error.message)
    } else if (backup.performed) {
      logger.info('Database', `Startup backup written: ${backup.backupPaths?.join(', ')}`)
    }
  }

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -8000') // 8MB cache

  createSchema(db)
  migrateFromJson(db, dataDir)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function isDatabaseInitialized(): boolean {
  return db !== null
}
