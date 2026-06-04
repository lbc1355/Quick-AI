import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      storeGet: (key: string) => Promise<any>
      storeSet: (key: string, value: any) => Promise<boolean>
      getAppInfo: () => Promise<{ storePath: string; version: string }>
      hideWindow: () => void
      toggleDevTools: () => void
    }
  }
}

