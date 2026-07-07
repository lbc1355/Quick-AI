import { ipcMain } from 'electron'
import { listMemoryEntries, readMemoryEntry, writeMemoryEntry } from '../memory/memoryStore'

export function registerMemoryIpc(): void {
  ipcMain.handle('memory-entries', () => {
    return listMemoryEntries()
  })

  ipcMain.handle('memory-entry-read', (_event, id) => {
    return typeof id === 'string' ? readMemoryEntry(id) : ''
  })

  ipcMain.handle('memory-entry-write', async (_event, id, content) => {
    if (typeof id !== 'string' || typeof content !== 'string') {
      throw new Error('memory-entry-write requires string id and content')
    }
    await writeMemoryEntry(id, content)
    return { ok: true }
  })
}
