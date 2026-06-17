import { ElectronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  AgentSkillRunOptions,
  ChatChunkData,
  ChatRunOptions,
  ClearSessionCachesPayload,
  ForkSessionCachesPayload,
  McpServerStatus,
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
      respondUserChoice: (
        reqId: string,
        requestId: string,
        response: UserChoiceResponse
      ) => void
      abortGeneration: (reqId: string) => void
      clearSessionCaches: (payload: ClearSessionCachesPayload) => Promise<{ ok: boolean }>
      forkSessionCaches: (
        payload: ForkSessionCachesPayload
      ) => Promise<{ ok: boolean; actions: number; checkpoints: number; manifests: number }>
      showNotification: (title: string, body: string) => void
      onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
      onSkillsUpdated: (callback: (skills: Skill[]) => void) => () => void
      onWindowStateChanged: (callback: (state: WindowState) => void) => () => void
      onUserChoiceRequest: (callback: (request: UserChoiceRequest) => void) => () => void
      fetchModels: (fetchUrl: string, apiKey: string) => Promise<string[]>
      listMemoryEntries: () => Promise<Array<{ id: string; label: string; kind: string }>>
      readMemoryEntry: (id: string) => Promise<string>
      writeMemoryEntry: (id: string, content: string) => Promise<{ ok: boolean }>
      mcpGetConfig: () => Promise<string>
      mcpSetConfig: (content: string) => Promise<string>
      mcpGetStatus: () => Promise<McpServerStatus[]>
      mcpOpenConfig: () => Promise<void>
    }
  }
}
