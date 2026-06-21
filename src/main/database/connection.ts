import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { createSchema } from './schema'
import { migrateFromJson } from './migration'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'quickai.db')
  db = new Database(dbPath)

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
