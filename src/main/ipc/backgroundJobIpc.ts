import { ipcMain } from 'electron'
import { cancelBackgroundJobForSession, listBackgroundJobs } from '../agent/backgroundJobManager'

export function registerBackgroundJobIpc(): void {
  ipcMain.handle('background-job-list', (_event, sessionId: unknown) => {
    const owner = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined
    return listBackgroundJobs(owner).filter((job) => job.sessionId === owner)
  })

  ipcMain.handle('background-job-cancel', (_event, id: unknown, sessionId: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('background-job-cancel requires a job id')
    }
    const owner = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined
    const job = cancelBackgroundJobForSession(id.trim(), owner)
    if (!job) throw new Error(`Background job ${id.trim()} was not found in this conversation`)
    return job
  })
}
