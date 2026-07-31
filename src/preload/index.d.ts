import { ElectronAPI } from '@electron-toolkit/preload'
import { PreloadApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: PreloadApi
  }
}
