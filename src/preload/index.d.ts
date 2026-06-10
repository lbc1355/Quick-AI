import { ElectronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  AgentSkillRunOptions,
  ChatChunkData,
  ChatRunOptions,
  ClearSessionCachesPayload,
  ForkSessionCachesPayload
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      storeGet: <K extends StoreKey>(key: K) => Promise<StoreValue<K>>
      storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>) => Promise<boolean>
      getAppInfo: () => Promise<{ storePath: string; version: string }>
      hideWindow: () => void
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
          | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
      ) => void
      abortGeneration: (reqId: string) => void
      clearSessionCaches: (payload: ClearSessionCachesPayload) => Promise<{ ok: boolean }>
      forkSessionCaches: (
        payload: ForkSessionCachesPayload
      ) => Promise<{ ok: boolean; actions: number; checkpoints: number; manifests: number }>
      showNotification: (title: string, body: string) => void
      onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
      fetchModels: (fetchUrl: string, apiKey: string) => Promise<string[]>
      listMemoryDocs: (opts?: any) => Promise<any[]>
      getCurrentMemoryDoc: (input: any) => Promise<any>
      replaceMemoryDoc: (input: any) => Promise<any>
      archiveMemoryDoc: (input: any) => Promise<boolean>
    }
  }
}
