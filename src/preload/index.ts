import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { StoreKey, StoreValue } from '../shared/types'

// Custom APIs for renderer
const api = {
  storeGet: <K extends StoreKey>(key: K) => ipcRenderer.invoke('store-get', key),
  storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>) => ipcRenderer.invoke('store-set', key, value),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  setFilePickerActive: (active: boolean) => ipcRenderer.send('set-file-picker-active', active),
  reSummonWindow: () => ipcRenderer.send('re-summon-window'),
  startChatCompletion: (reqId: string, options: {
    apiUrl: string
    apiKey: string
    model: string
    messages: any[]
  }) => ipcRenderer.send('start-chat-completion', reqId, options),
  onChatChunk: (callback: (data: { reqId: string; content?: string; reasoningContent?: string; done?: boolean; error?: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat-chunk', listener)
    return () => ipcRenderer.removeListener('chat-chunk', listener)
  }
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

