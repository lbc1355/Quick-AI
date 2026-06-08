import Database from 'better-sqlite3'
import { describe } from 'vitest'

export const sqliteNativeAvailable = (() => {
  try {
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
})()

export const describeWithSqlite = sqliteNativeAvailable ? describe : describe.skip
