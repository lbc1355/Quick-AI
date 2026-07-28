import { ipcMain, dialog } from 'electron'
import { realpathSync } from 'fs'
import { basename } from 'path'
import type { WindowController } from './windowIpc'
import { deleteProject } from '../database/projectStore'

export function registerProjectIpc(controller: WindowController): void {
  ipcMain.handle('select-project-directory', async () => {
    const mainWindow = controller.getMainWindow()
    if (!mainWindow) return null

    controller.setFilePickerActive(true)
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择项目文件夹',
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const selectedPath = realpathSync.native(result.filePaths[0])
      return {
        path: selectedPath,
        name: basename(selectedPath)
      }
    } finally {
      setTimeout(() => {
        controller.setFilePickerActive(false)
      }, 300)
    }
  })

  ipcMain.handle('delete-project', (_event, projectId: string, options?: unknown) => {
    const normalizedId = typeof projectId === 'string' ? projectId.trim() : ''
    if (!normalizedId) throw new Error('Project id is required')
    const deleteSessions =
      !!options &&
      typeof options === 'object' &&
      (options as { deleteSessions?: unknown }).deleteSessions === true
    return deleteProject(normalizedId, deleteSessions)
  })
}
