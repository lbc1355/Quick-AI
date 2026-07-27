import { describe, expect, it } from 'vitest'
import {
  fromPersistedProjectRow,
  getFilesystemProjectPath,
  isConversationFolder,
  toPersistedProjectPath
} from './projectHelpers'

describe('projectHelpers', () => {
  it('treats missing kind as a filesystem project when a path exists', () => {
    const project = { id: 'p1', name: 'Repo', path: 'D:/repo', createdAt: 1, updatedAt: 1 }
    expect(isConversationFolder(project)).toBe(false)
    expect(getFilesystemProjectPath(project)).toBe('D:/repo')
  })

  it('hides filesystem roots for conversation folders', () => {
    const project = { id: 'f1', name: '笔记', kind: 'folder' as const, createdAt: 1, updatedAt: 1 }
    expect(isConversationFolder(project)).toBe(true)
    expect(getFilesystemProjectPath(project)).toBeUndefined()
    expect(toPersistedProjectPath(project)).toBe('quickai-folder://f1')
  })

  it('round-trips a folder row without exposing the sentinel path', () => {
    const project = fromPersistedProjectRow({
      id: 'f1',
      name: '笔记',
      path: 'quickai-folder://f1',
      kind: 'folder',
      createdAt: 1,
      updatedAt: 1
    })
    expect(project).toEqual({
      id: 'f1',
      name: '笔记',
      kind: 'folder',
      createdAt: 1,
      updatedAt: 1
    })
  })
})
