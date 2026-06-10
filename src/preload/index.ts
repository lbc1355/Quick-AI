import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  AgentSkillRunOptions,
  ChatChunkData,
  ChatRunOptions,
  ClearSessionCachesPayload,
  ForkSessionCachesPayload
} from '../shared/types'

// Custom APIs for renderer
const api = {
  storeGet: <K extends StoreKey>(key: K): Promise<StoreValue<K>> =>
    ipcRenderer.invoke('store-get', key),
  storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>): Promise<boolean> =>
    ipcRenderer.invoke('store-set', key, value),
  getAppInfo: (): Promise<{ storePath: string; version: string }> =>
    ipcRenderer.invoke('get-app-info'),
  hideWindow: (): void => ipcRenderer.send('hide-window'),
  toggleDevTools: (): void => ipcRenderer.send('toggle-devtools'),
  setFilePickerActive: (active: boolean): void =>
    ipcRenderer.send('set-file-picker-active', active),
  setWindowPinned: (pinned: boolean): void => ipcRenderer.send('set-window-pinned', pinned),
  reSummonWindow: (): void => ipcRenderer.send('re-summon-window'),
  startChatCompletion: (reqId: string, options: ChatRunOptions): void =>
    ipcRenderer.send('start-chat-completion', reqId, options),
  startAgentSkill: (reqId: string, options: AgentSkillRunOptions): void =>
    ipcRenderer.send('start-agent-skill', reqId, options),
  respondToolPermission: (
    reqId: string,
    callId: string,
    approved:
      | boolean
      | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
  ): void => ipcRenderer.send('respond-tool-permission', reqId, callId, approved),
  abortGeneration: (reqId: string): void => ipcRenderer.send('abort-generation', reqId),
  clearSessionCaches: (payload: ClearSessionCachesPayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('clear-session-caches', payload),
  forkSessionCaches: (
    payload: ForkSessionCachesPayload
  ): Promise<{ ok: boolean; actions: number; checkpoints: number; manifests: number }> =>
    ipcRenderer.invoke('fork-session-caches', payload),
  onChatChunk: (callback: (data: ChatChunkData) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: ChatChunkData): void => callback(data)
    ipcRenderer.on('chat-chunk', listener)
    return (): void => {
      ipcRenderer.removeListener('chat-chunk', listener)
    }
  },
  showNotification: (title: string, body: string): void =>
    ipcRenderer.send('show-notification', title, body),
  fetchModels: (fetchUrl: string, apiKey: string): Promise<string[]> =>
    ipcRenderer.invoke('fetch-models', fetchUrl, apiKey),
  listMemoryDocs: (opts?: any): Promise<any[]> =>
    ipcRenderer.invoke('memory-list', opts),
  getCurrentMemoryDoc: (input: any): Promise<any> =>
    ipcRenderer.invoke('memory-read', input),
  replaceMemoryDoc: (input: any): Promise<any> =>
    ipcRenderer.invoke('memory-replace', input),
  archiveMemoryDoc: (input: any): Promise<boolean> =>
    ipcRenderer.invoke('memory-archive', input)
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
