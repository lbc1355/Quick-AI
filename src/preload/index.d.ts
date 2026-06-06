import { ElectronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  ChatCompletionMessage,
  AgentSkillRunOptions,
  ChatChunkData
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
      reSummonWindow: () => void
      startChatCompletion: (
        reqId: string,
        options: {
          apiUrl: string
          apiKey: string
          model: string
          messages: ChatCompletionMessage[]
        }
      ) => void
      startAgentSkill: (reqId: string, options: AgentSkillRunOptions) => void
      respondToolPermission: (reqId: string, callId: string, approved: boolean) => void
      abortGeneration: (reqId: string) => void
      onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
      fetchModels: (fetchUrl: string, apiKey: string) => Promise<string[]>
    }
  }
}
