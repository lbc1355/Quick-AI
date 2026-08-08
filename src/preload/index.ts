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
  Skill,
  UserChoiceRequest,
  UserChoiceResponse,
  WindowMode,
  WindowState,
  AdmitSessionPromptInput,
  AdmitSessionPromptResult,
  SessionPromptAdmission,
  SessionRunStateNotification,
  AgentFileRevertPreview,
  RevertAgentFileChangesInput,
  RevertAgentFileChangesResult,
  SessionFileTransitionInput,
  SessionFileTransitionPreview,
  SessionFileTransitionResult,
  BackgroundShellResultNotification,
  BackgroundSubagentResultNotification,
  BackgroundSubagentEventNotification,
  BackgroundJobInfo,
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryCache,
  ProviderConnectionTestResult,
  DeleteProjectResult,
  PreloadApi
} from '../shared/types'

// Custom APIs for renderer
const api = {
  storeGet: <K extends StoreKey>(key: K): Promise<StoreValue<K>> =>
    ipcRenderer.invoke('store-get', key),
  storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>): Promise<boolean> =>
    ipcRenderer.invoke('store-set', key, value),
  getAppInfo: (): Promise<{ storePath: string; version: string }> =>
    ipcRenderer.invoke('get-app-info'),
  listAgentTools: (): Promise<AgentToolInfo[]> => ipcRenderer.invoke('list-agent-tools'),
  selectProjectDirectory: (): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('select-project-directory'),
  deleteProject: (
    projectId: string,
    options?: { deleteSessions?: boolean }
  ): Promise<DeleteProjectResult> => ipcRenderer.invoke('delete-project', projectId, options),
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
  advanceSessionContext: (sessionId: string, contextEpoch: number): void =>
    ipcRenderer.send('advance-session-context', sessionId, contextEpoch),
  admitSessionPrompt: (input: AdmitSessionPromptInput): Promise<AdmitSessionPromptResult> =>
    ipcRenderer.invoke('admit-session-prompt', input),
  listSessionPrompts: (sessionId: string): Promise<SessionPromptAdmission[]> =>
    ipcRenderer.invoke('list-session-prompts', sessionId),
  claimNextSessionPrompt: (
    sessionId: string,
    contextEpoch?: number
  ): Promise<SessionPromptAdmission | undefined> =>
    ipcRenderer.invoke('claim-next-session-prompt', sessionId, contextEpoch),
  completeSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('complete-session-prompt', admissionId),
  cancelSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('cancel-session-prompt', admissionId),
  requeueSessionPrompt: (admissionId: string): Promise<boolean> =>
    ipcRenderer.invoke('requeue-session-prompt', admissionId),
  compactContext: (payload: ContextCompactionRequest): Promise<ContextCompactionResult> =>
    ipcRenderer.invoke('compact-context', payload),
  previewAgentFileRevert: (sessionId: string, runId: string): Promise<AgentFileRevertPreview> =>
    ipcRenderer.invoke('preview-agent-file-revert', sessionId, runId),
  revertAgentFileChanges: (
    input: RevertAgentFileChangesInput
  ): Promise<RevertAgentFileChangesResult> =>
    ipcRenderer.invoke('revert-agent-file-changes', input),
  previewSessionFileTransition: (
    input: SessionFileTransitionInput
  ): Promise<SessionFileTransitionPreview> =>
    ipcRenderer.invoke('preview-session-file-transition', input),
  applySessionFileTransition: (
    input: SessionFileTransitionInput
  ): Promise<SessionFileTransitionResult> =>
    ipcRenderer.invoke('apply-session-file-transition', input),
  clearSessionCaches: (payload: ClearSessionCachesPayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('clear-session-caches', payload),
  forkSessionCaches: (
    payload: ForkSessionCachesPayload
  ): Promise<{
    ok: boolean
    actions: number
    checkpoints: number
    manifests: number
    events: number
  }> => ipcRenderer.invoke('fork-session-caches', payload),
  onChatChunk: (callback: (data: ChatChunkData) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: ChatChunkData): void => callback(data)
    ipcRenderer.on('chat-chunk', listener)
    return (): void => {
      ipcRenderer.removeListener('chat-chunk', listener)
    }
  },
  onSessionRunState: (callback: (state: SessionRunStateNotification) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: SessionRunStateNotification): void =>
      callback(state)
    ipcRenderer.on('session-run-state', listener)
    return (): void => {
      ipcRenderer.removeListener('session-run-state', listener)
    }
  },
  onBackgroundSubagentResult: (
    callback: (notification: BackgroundSubagentResultNotification) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      notification: BackgroundSubagentResultNotification
    ): void => callback(notification)
    ipcRenderer.on('background-subagent-result', listener)
    return (): void => {
      ipcRenderer.removeListener('background-subagent-result', listener)
    }
  },
  onBackgroundShellResult: (
    callback: (notification: BackgroundShellResultNotification) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      notification: BackgroundShellResultNotification
    ): void => callback(notification)
    ipcRenderer.on('background-shell-result', listener)
    return (): void => {
      ipcRenderer.removeListener('background-shell-result', listener)
    }
  },
  onBackgroundSubagentEvent: (
    callback: (notification: BackgroundSubagentEventNotification) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      notification: BackgroundSubagentEventNotification
    ): void => callback(notification)
    ipcRenderer.on('background-subagent-event', listener)
    return (): void => {
      ipcRenderer.removeListener('background-subagent-event', listener)
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
  fetchModels: (request: ProviderModelDiscoveryRequest): Promise<FetchedModelInfo[]> =>
    ipcRenderer.invoke('fetch-models', request),
  testProviderConnection: (
    request: ProviderModelDiscoveryRequest
  ): Promise<ProviderConnectionTestResult> =>
    ipcRenderer.invoke('test-provider-connection', request),
  setProviderModelDiscoveryCache: (
    accountId: string,
    cache: ProviderModelDiscoveryCache
  ): Promise<boolean> => ipcRenderer.invoke('provider-model-discovery-cache-set', accountId, cache),
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
  backgroundJobList: (sessionId?: string): Promise<BackgroundJobInfo[]> =>
    ipcRenderer.invoke('background-job-list', sessionId),
  backgroundJobCancel: (id: string): Promise<BackgroundJobInfo> =>
    ipcRenderer.invoke('background-job-cancel', id)
} satisfies PreloadApi

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
