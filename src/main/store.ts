import {
  loadSettings,
  saveSettings,
  loadSessions,
  saveSessions,
  getDb,
  loadProjects,
  saveProjects,
  recoverRunningSessionPrompts,
  recoverRunningBackgroundJobs,
  pruneBackgroundJobRecords
} from './database'
import { StorageSchema } from '../shared/types'
import { recoverInterruptedAgentEventJournals } from './agent/agentEventJournal'
import { finishRunManifest } from './agent/runManifest'
import { loadSkillsFromFolders, saveSkillsToFolders } from './skillManager'

export class FileStore {
  private ready: boolean

  constructor() {
    // Initialize the database (creates file + migrates old JSON if needed)
    getDb()
    recoverRunningSessionPrompts()
    recoverRunningBackgroundJobs()
    pruneBackgroundJobRecords()
    const interruptedRuns = recoverInterruptedAgentEventJournals()
    for (const run of interruptedRuns) {
      const terminalEvent = [...run.events].reverse().find((event) => event.type === 'agent_end')
      finishRunManifest(
        run.sessionId,
        run.runId,
        'failed',
        terminalEvent?.type === 'agent_end' ? terminalEvent.error : undefined
      )
    }
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
        return loadSkillsFromFolders() as StorageSchema[K]
      case 'projects':
        return loadProjects() as StorageSchema[K]
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
        saveSkillsToFolders(val as StorageSchema['skills'])
        break
      case 'projects':
        saveProjects(val as StorageSchema['projects'])
        break
      default:
        throw new Error(`Unknown store key: ${key}`)
    }
  }

  public getStorePath(): string {
    return getDb().name
  }
}
