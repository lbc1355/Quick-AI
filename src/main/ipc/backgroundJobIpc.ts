import { ipcMain } from 'electron'
import { cancelBackgroundJob, listBackgroundJobs } from '../agent/backgroundJobManager'

export function registerBackgroundJobIpc(): void {
  ipcMain.handle('background-job-list', (_event, sessionId: unknown) =>
    listBackgroundJobs(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined
    )
  )

  ipcMain.handle('background-job-cancel', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('background-job-cancel requires a job id')
    }
    const job = cancelBackgroundJob(id.trim())
    if (!job) throw new Error(`Background job ${id.trim()} was not found`)
    return job
  })
}
