import { ipcMain } from 'electron'
import type { FileStore } from '../store'
import type { StorageSchema } from '../../shared/types'

const ALLOWED_STORE_KEYS = ['sessions', 'settings', 'skills', 'projects']

export function registerStoreIpc(
  store: FileStore,
  onSkillsUpdated: (skills: StorageSchema['skills']) => void
): void {
  ipcMain.handle('store-get', (_event, key) => {
    if (typeof key !== 'string' || !ALLOWED_STORE_KEYS.includes(key)) {
      throw new Error(`Forbidden store-get key: ${key}`)
    }
    const storeKey = key as keyof StorageSchema
    return store.get(storeKey)
  })

  ipcMain.handle('store-set', (_event, key, value) => {
    if (typeof key !== 'string' || !ALLOWED_STORE_KEYS.includes(key)) {
      throw new Error(`Forbidden store-set key: ${key}`)
    }
    const storeKey = key as keyof StorageSchema
    store.set(storeKey, value as StorageSchema[typeof storeKey])
    if (storeKey === 'skills') {
      onSkillsUpdated(store.get('skills') as StorageSchema['skills'])
    }
    return true
  })

  ipcMain.handle('get-app-info', () => {
    return {
      storePath: store.getStorePath() || '',
      version: '1.0.0'
    }
  })
}
