import { ipcMain, dialog, type MessageBoxOptions } from 'electron'
import { realpathSync } from 'fs'
import { basename } from 'path'
import type { WindowController } from './windowIpc'

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

  ipcMain.handle('show-message-box', async (_event, options: MessageBoxOptions) => {
    const mainWindow = controller.getMainWindow()
    if (!mainWindow) {
      const result = await dialog.showMessageBox(options)
      return result.response
    }
    const result = await dialog.showMessageBox(mainWindow, options)
    return result.response
  })
}
