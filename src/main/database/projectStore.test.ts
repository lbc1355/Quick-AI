import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import type { Project, Session } from '../../shared/types'
import { describeWithSqlite } from '../testSupport/nativeSqlite'
import {
  closeDb,
  deleteProject,
  getDb,
  loadProjects,
  loadSessions,
  saveProjects,
  saveSessions
} from '../database'

const testDir = join(__dirname, '../../../temp-project-store-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

const folder = (id: string): Project => ({
  id,
  name: id,
  kind: 'folder',
  createdAt: 1,
  updatedAt: 1
})

const project = (id: string): Project => ({
  id,
  name: id,
  kind: 'filesystem',
  path: `D:\\${id}`,
  createdAt: 1,
  updatedAt: 1
})

const session = (id: string, projectId: string): Session => ({
  id,
  title: id,
  projectId,
  messages: [{ id: `${id}-message`, role: 'user', content: id }]
})

describeWithSqlite('transactional project deletion', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('keeps conversations and detaches them when removing a project', () => {
    saveProjects([project('workspace')])
    saveSessions([session('session-1', 'workspace')])

    expect(deleteProject('workspace', true)).toEqual({ deletedSessionIds: [] })
    expect(loadProjects()).toEqual([])
    expect(loadSessions()).toMatchObject([{ id: 'session-1', projectId: undefined }])
  })

  it('deletes conversations together with a conversation folder', () => {
    saveProjects([folder('folder-a'), folder('folder-b')])
    saveSessions([session('delete-me', 'folder-a'), session('keep-me', 'folder-b')])

    expect(deleteProject('folder-a', true)).toEqual({
      deletedSessionIds: ['delete-me']
    })
    expect(loadProjects().map((item) => item.id)).toEqual(['folder-b'])
    expect(loadSessions().map((item) => item.id)).toEqual(['keep-me'])
  })

  it('rolls back session deletion when deleting the project fails', () => {
    saveProjects([folder('folder-a')])
    saveSessions([session('session-1', 'folder-a')])
    getDb().exec(`
      CREATE TRIGGER reject_project_delete
      BEFORE DELETE ON projects
      BEGIN
        SELECT RAISE(ABORT, 'project delete rejected');
      END;
    `)

    expect(() => deleteProject('folder-a', true)).toThrow('project delete rejected')
    expect(loadProjects().map((item) => item.id)).toEqual(['folder-a'])
    expect(loadSessions().map((item) => item.id)).toEqual(['session-1'])
  })
})
