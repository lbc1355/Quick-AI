import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  setFilePickerActive: (active: boolean) => ipcRenderer.send('set-file-picker-active', active),
  reSummonWindow: () => ipcRenderer.send('re-summon-window')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

