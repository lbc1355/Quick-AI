import { ElectronAPI } from '@electron-toolkit/preload'
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
  WindowState
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      storeGet: <K extends StoreKey>(key: K) => Promise<StoreValue<K>>
      storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>) => Promise<boolean>
      getAppInfo: () => Promise<{ storePath: string; version: string }>
      listAgentTools: () => Promise<AgentToolInfo[]>
      selectProjectDirectory: () => Promise<Pick<Project, 'name' | 'path'> | null>
      hideWindow: () => void
      getWindowState: () => Promise<WindowState>
      setWindowMode: (mode: WindowMode) => Promise<WindowState>
      minimizeWindow: () => void
      toggleWindowMaximized: () => void
      toggleDevTools: () => void
      setFilePickerActive: (active: boolean) => void
      setWindowPinned: (pinned: boolean) => void
      reSummonWindow: () => void
      startChatCompletion: (reqId: string, options: ChatRunOptions) => void
      startAgentSkill: (reqId: string, options: AgentSkillRunOptions) => void
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
      ) => void
      respondUserChoice: (reqId: string, requestId: string, response: UserChoiceResponse) => void
      abortGeneration: (reqId: string) => void
      compactContext: (payload: ContextCompactionRequest) => Promise<ContextCompactionResult>
      clearSessionCaches: (payload: ClearSessionCachesPayload) => Promise<{ ok: boolean }>
      forkSessionCaches: (
        payload: ForkSessionCachesPayload
      ) => Promise<{ ok: boolean; actions: number; checkpoints: number; manifests: number }>
      showNotification: (title: string, body: string) => void
      onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
      onSkillsUpdated: (callback: (skills: Skill[]) => void) => () => void
      onWindowStateChanged: (callback: (state: WindowState) => void) => () => void
      onUserChoiceRequest: (callback: (request: UserChoiceRequest) => void) => () => void
      fetchModels: (fetchUrl: string, apiKey: string) => Promise<FetchedModelInfo[]>
      listMemoryEntries: () => Promise<Array<{ id: string; label: string; kind: string }>>
      readMemoryEntry: (id: string) => Promise<string>
      writeMemoryEntry: (id: string, content: string) => Promise<{ ok: boolean }>
      mcpGetConfig: () => Promise<string>
      mcpSetConfig: (content: string) => Promise<string>
      mcpDeleteServer: (name: string) => Promise<{ deleted: boolean; config: string }>
      mcpGetStatus: () => Promise<McpServerStatus[]>
      mcpReloadServer: (name: string) => Promise<McpServerStatus>
      mcpOpenConfig: () => Promise<void>
      bgShellList: (sessionId?: string) => Promise<
        Array<{
          id: string
          command: string
          status: string
          pid?: number
          createdAt: number
          totalOutputChars: number
        }>
      >
      bgShellReadLog: (id: string) => Promise<{
        output: string
        status: string
        totalOutputChars: number
      }>
      bgShellStop: (id: string) => Promise<void>
    }
  }
}
