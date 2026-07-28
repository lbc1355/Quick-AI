export { closeDb, getDb, isDatabaseInitialized } from './database/connection'
export { loadSettings, saveSettings } from './database/settingsStore'
export { deleteProject, loadProjects, saveProjects } from './database/projectStore'
export { loadSessions, saveSessions } from './database/sessionStore'
export {
  admitSessionPrompt,
  cancelSessionPrompt,
  cancelStaleSessionPrompts,
  claimNextSessionPrompt,
  completeSessionPrompt,
  finishSessionPrompt,
  getSessionPrompt,
  listSessionPrompts,
  markSessionPromptRunning,
  recoverRunningSessionPrompts,
  requeueSessionPrompts
} from './database/sessionPromptStore'
export { loadSkills, saveSkills } from './database/skillStore'
export {
  getBackgroundJobRecord,
  listBackgroundJobRecords,
  pruneBackgroundJobRecords,
  recoverRunningBackgroundJobs,
  saveBackgroundJob
} from './database/backgroundJobStore'
export {
  deleteResourceFromDb,
  getResourceChunkText,
  getResourceChunksMetadata,
  getResourceFullText,
  getResourceLink,
  loadResourceCache,
  loadResourceLinks,
  pruneResourceChunks,
  saveResourceLinks,
  upsertResourceCache,
  upsertResourceChunk
} from './database/resourceStore'
