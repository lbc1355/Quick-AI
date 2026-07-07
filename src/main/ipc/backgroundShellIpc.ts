import { ipcMain } from 'electron'
import {
  getBackgroundShells,
  readBackgroundShellLog,
  stopBackgroundShell
} from '../tools/backgroundShell'

export function registerBackgroundShellIpc(): void {
  ipcMain.handle('bg-shell-list', (_event, sessionId) => {
    return getBackgroundShells(typeof sessionId === 'string' ? sessionId : undefined)
  })

  ipcMain.handle('bg-shell-read-log', (_event, id) => {
    if (typeof id !== 'string') throw new Error('bg-shell-read-log requires string id')
    return readBackgroundShellLog(id)
  })

  ipcMain.handle('bg-shell-stop', async (_event, id) => {
    if (typeof id !== 'string') throw new Error('bg-shell-stop requires string id')
    await stopBackgroundShell(id)
    return { ok: true }
  })
}
