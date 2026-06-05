import { ElectronAPI } from '@electron-toolkit/preload'
import { StoreKey, StoreValue } from '../shared/types'

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
      startChatCompletion: (reqId: string, options: {
        apiUrl: string
        apiKey: string
        model: string
        messages: any[]
      }) => void
      onChatChunk: (callback: (data: {
        reqId: string
        content?: string
        reasoningContent?: string
        done?: boolean
        error?: string
      }) => void) => () => void
    }
  }
}

