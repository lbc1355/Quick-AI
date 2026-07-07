import { ipcMain, BrowserWindow } from 'electron'
import type { WindowMode, WindowState } from '../../shared/types'
import { showDesktopNotification } from '../tools/helpers'

export interface WindowController {
  hideWindow: () => void
  showWindow: () => void
  minimizeWindow: () => void
  toggleWindowMaximized: () => void
  getCurrentWindowState: () => WindowState
  setWindowMode: (mode: WindowMode) => WindowState
  setFilePickerActive: (active: boolean) => void
  setWindowPinned: (pinned: boolean) => void
  toggleDevTools: () => void
  reSummonWindow: () => void
  getMainWindow: () => BrowserWindow | null
}

export function registerWindowIpc(controller: WindowController): void {
  ipcMain.on('hide-window', () => {
    controller.hideWindow()
  })

  ipcMain.handle('get-window-state', () => {
    return controller.getCurrentWindowState()
  })

  ipcMain.handle('set-window-mode', (_event, mode: WindowMode) => {
    if (mode !== 'floating' && mode !== 'window') {
      throw new Error(`Invalid window mode: ${String(mode)}`)
    }
    return controller.setWindowMode(mode)
  })

  ipcMain.on('minimize-window', () => {
    controller.minimizeWindow()
  })

  ipcMain.on('toggle-window-maximized', () => {
    controller.toggleWindowMaximized()
  })

  ipcMain.on('set-file-picker-active', (_event, active) => {
    controller.setFilePickerActive(active)
  })

  ipcMain.on('set-window-pinned', (_event, pinned) => {
    controller.setWindowPinned(pinned === true)
  })

  ipcMain.on('re-summon-window', () => {
    controller.reSummonWindow()
  })

  ipcMain.on('toggle-devtools', () => {
    controller.toggleDevTools()
  })

  ipcMain.on('show-notification', (_event, title: string, body: string) => {
    showDesktopNotification(String(title || 'QuickAI'), String(body || ''), () => {
      controller.showWindow()
    })
  })
}
