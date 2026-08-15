import { app } from 'electron'
import Database from 'better-sqlite3'
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

  // Startup backup keeps the last snapshots before anything can mutate the live db.
  const restored = restoreLatestBackupIfNeeded(dataDir)
  if (restored) {
    logger.warn(
      'Database',
      'quickai.db was missing; restored it from the newest backup. Recent data may be lost.'
    )
  }

  db = new Database(dbPath)

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -8000') // 8MB cache

  createSchema(db)
  migrateFromJson(db, dataDir)

  const backup = createStartupBackup(db, dataDir)
  if (backup.error) {
    logger.warn('Database', 'Startup backup failed:', backup.error.message)
  } else if (backup.performed) {
    logger.info('Database', `Startup backup written: ${backup.backupPath}`)
  }

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
