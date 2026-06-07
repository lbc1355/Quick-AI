import {
  loadSettings,
  saveSettings,
  loadSessions,
  saveSessions,
  loadSkills,
  saveSkills,
  loadMemories,
  saveMemories,
  getDb
} from './database'
import { StorageSchema } from '../shared/types'

export class FileStore {
  private ready: boolean

  constructor() {
    // Initialize the database (creates file + migrates old JSON if needed)
    getDb()
    this.ready = true
  }

  public get<K extends keyof StorageSchema>(key: K): StorageSchema[K] {
    if (!this.ready) throw new Error('Store not initialized')

    switch (key) {
      case 'settings':
        return loadSettings() as StorageSchema[K]
      case 'sessions':
        return loadSessions() as StorageSchema[K]
      case 'skills':
        return loadSkills() as StorageSchema[K]
      case 'memories':
        return loadMemories() as StorageSchema[K]
      default:
        throw new Error(`Unknown store key: ${key}`)
    }
  }

  public set<K extends keyof StorageSchema>(key: K, val: StorageSchema[K]): void {
    if (!this.ready) throw new Error('Store not initialized')

    switch (key) {
      case 'settings':
        saveSettings(val as StorageSchema['settings'])
        break
      case 'sessions':
        saveSessions(val as StorageSchema['sessions'])
        break
      case 'skills':
        saveSkills(val as StorageSchema['skills'])
        break
      case 'memories':
        saveMemories(val as StorageSchema['memories'])
        break
      default:
        throw new Error(`Unknown store key: ${key}`)
    }
  }

  public getStorePath(): string {
    return getDb().name
  }
}
