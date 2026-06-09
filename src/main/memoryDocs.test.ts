import { vi, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import {
  closeDb,
  getCurrentMemoryDoc,
  listMemoryDocs,
  replaceMemoryDoc,
  deleteSessionMemories
} from './database'
import { describeWithSqlite } from './testSupport/nativeSqlite'

const testDir = join(__dirname, '../../temp-memory-docs-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describeWithSqlite('memory_docs DAL', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('creates a first current document version', () => {
    const doc = replaceMemoryDoc({
      kind: 'soul',
      scope: 'global',
      key: 'assistant_profile',
      title: 'Assistant Profile',
      content: 'Name: QuickAI'
    })

    expect(doc.version).toBe(1)
    expect(doc.status).toBe('current')
    expect(getCurrentMemoryDoc({ kind: 'soul', scope: 'global', key: 'assistant_profile' })?.id).toBe(
      doc.id
    )
  })

  it('archives the old version and requires the current baseVersionId', () => {
    const first = replaceMemoryDoc({
      kind: 'memory',
      scope: 'global',
      key: 'default',
      content: '- user likes concise answers'
    })

    expect(() =>
      replaceMemoryDoc({
        kind: 'memory',
        scope: 'global',
        key: 'default',
        content: '- user likes detailed answers'
      })
    ).toThrow(/baseVersionId is required/)

    const second = replaceMemoryDoc({
      kind: 'memory',
      scope: 'global',
      key: 'default',
      content: '- user likes detailed answers',
      baseVersionId: first.id
    })

    expect(second.version).toBe(2)
    expect(second.parentId).toBe(first.id)
    expect(listMemoryDocs({ scope: 'global', status: 'current' }).map((doc) => doc.id)).toEqual([
      second.id
    ])
    expect(listMemoryDocs({ scope: 'global', status: 'archived' }).map((doc) => doc.id)).toEqual([
      first.id
    ])
  })

  it('lists global plus current session documents and deletes session-scoped docs', () => {
    replaceMemoryDoc({
      kind: 'memory',
      scope: 'global',
      key: 'default',
      content: '- global'
    })
    replaceMemoryDoc({
      kind: 'memory',
      scope: 'session',
      sessionId: 'sess-A',
      key: 'default',
      content: '- session A'
    })
    replaceMemoryDoc({
      kind: 'memory',
      scope: 'session',
      sessionId: 'sess-B',
      key: 'default',
      content: '- session B'
    })

    expect(
      listMemoryDocs({ sessionId: 'sess-A', includeSession: true }).map((doc) => doc.content)
    ).toEqual(['- global', '- session A'])

    expect(deleteSessionMemories('sess-A')).toBe(1)
    expect(listMemoryDocs({ scope: 'session', sessionId: 'sess-A' })).toHaveLength(0)
    expect(listMemoryDocs({ scope: 'global' })).toHaveLength(1)
  })
})
