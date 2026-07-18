import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  AgentToolInfo,
  AgentSkillRunOptions,
  ChatChunkData,
  ChatRunOptions,
  ContextCompactionRequest,
  ContextCompactionResult,
  ClearSessionCachesPayload,
  ForkSessionCachesPayload,
  McpServerStatus,
  FetchedModelInfo,
  Project,
  Skill,
  UserChoiceRequest,
  UserChoiceResponse,
  WindowMode,
  WindowState,
  AdmitSessionPromptInput,
  AdmitSessionPromptResult,
  SessionPromptAdmission
} from '../shared/types'

interface BackgroundShellInfo {
  id: string
  command: string
  status: string
  pid?: number
  createdAt: number
  totalOutputChars: number
}

interface BackgroundShellLog {
  output: string
  status: string
  totalOutputChars: number
}

// Custom APIs for renderer
const api = {
  storeGet: <K extends StoreKey>(key: K): Promise<StoreValue<K>> =>
    ipcRenderer.invoke('store-get', key),
  storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>): Promise<boolean> =>
    ipcRenderer.invoke('store-set', key, value),
  getAppInfo: (): Promise<{ storePath: string; version: string }> =>
    ipcRenderer.invoke('get-app-info'),
  listAgentTools: (): Promise<AgentToolInfo[]> => ipcRenderer.invoke('list-agent-tools'),
  selectProjectDirectory: (): Promise<Pick<Project, 'name' | 'path'> | null> =>
    ipcRenderer.invoke('select-project-directory'),
  hideWindow: (): void => ipcRenderer.send('hide-window'),
  getWindowState: (): Promise<WindowState> => ipcRenderer.invoke('get-window-state'),
  setWindowMode: (mode: WindowMode): Promise<WindowState> =>
    ipcRenderer.invoke('set-window-mode', mode),
  minimizeWindow: (): void => ipcRenderer.send('minimize-window'),
  toggleWindowMaximized: (): void => ipcRenderer.send('toggle-window-maximized'),
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
      | {
          approved: boolean
          scope?: 'prefix' | 'tool'
          prefix?: string
          prefixes?: string[]
          tool?: string
        }
  ): void => ipcRenderer.send('respond-tool-permission', reqId, callId, approved),
  respondUserChoice: (reqId: string, requestId: string, response: UserChoiceResponse): void =>
    ipcRenderer.send('respond-user-choice', reqId, requestId, response),
  abortGeneration: (reqId: string): void => ipcRenderer.send('abort-generation', reqId),
  admitSessionPrompt: (input: AdmitSessionPromptInput): Promise<AdmitSessionPromptResult> =>
    ipcRenderer.invoke('admit-session-prompt', input),
  listSessionPrompts: (sessionId: string): Promise<SessionPromptAdmission[]> =>
    ipcRenderer.invoke('list-session-prompts', sessionId),
  claimNextSessionPrompt: (sessionId: string): Promise<SessionPromptAdmission | undefined> =>
    ipcRenderer.invoke('claim-next-session-prompt', sessionId),
  completeSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('complete-session-prompt', admissionId),
  cancelSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('cancel-session-prompt', admissionId),
  requeueSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('requeue-session-prompt', admissionId),
  compactContext: (payload: ContextCompactionRequest): Promise<ContextCompactionResult> =>
    ipcRenderer.invoke('compact-context', payload),
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
  onSkillsUpdated: (callback: (skills: Skill[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, skills: Skill[]): void => callback(skills)
    ipcRenderer.on('skills-updated', listener)
    return (): void => {
      ipcRenderer.removeListener('skills-updated', listener)
    }
  },
  onWindowStateChanged: (callback: (state: WindowState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: WindowState): void => callback(state)
    ipcRenderer.on('window-state-changed', listener)
    return (): void => {
      ipcRenderer.removeListener('window-state-changed', listener)
    }
  },
  onUserChoiceRequest: (callback: (request: UserChoiceRequest) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, request: UserChoiceRequest): void =>
      callback(request)
    ipcRenderer.on('user-choice-request', listener)
    return (): void => {
      ipcRenderer.removeListener('user-choice-request', listener)
    }
  },
  showNotification: (title: string, body: string): void =>
    ipcRenderer.send('show-notification', title, body),
  fetchModels: (fetchUrl: string, apiKey: string): Promise<FetchedModelInfo[]> =>
    ipcRenderer.invoke('fetch-models', fetchUrl, apiKey),
  listMemoryEntries: (): Promise<Array<{ id: string; label: string; kind: string }>> =>
    ipcRenderer.invoke('memory-entries'),
  readMemoryEntry: (id: string): Promise<string> => ipcRenderer.invoke('memory-entry-read', id),
  writeMemoryEntry: (id: string, content: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('memory-entry-write', id, content),
  mcpGetConfig: (): Promise<string> => ipcRenderer.invoke('mcp-get-config'),
  mcpSetConfig: (content: string): Promise<string> => ipcRenderer.invoke('mcp-set-config', content),
  mcpDeleteServer: (name: string): Promise<{ deleted: boolean; config: string }> =>
    ipcRenderer.invoke('mcp-delete-server', name),
  mcpGetStatus: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp-get-status'),
  mcpReloadServer: (name: string): Promise<McpServerStatus> =>
    ipcRenderer.invoke('mcp-reload-server', name),
  mcpOpenConfig: (): Promise<void> => ipcRenderer.invoke('mcp-open-config'),
  bgShellList: (sessionId?: string): Promise<BackgroundShellInfo[]> =>
    ipcRenderer.invoke('bg-shell-list', sessionId),
  bgShellReadLog: (id: string): Promise<BackgroundShellLog> =>
    ipcRenderer.invoke('bg-shell-read-log', id),
  bgShellStop: (id: string): Promise<void> => ipcRenderer.invoke('bg-shell-stop', id)
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
