import { vi, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { ToolRegistry } from './toolRegistry'
import { closeDb, getCurrentMemoryDoc, listMemoryDocs } from './database'
import * as runCtx from './agent/AgentRunContext'
import type { AgentRunContext } from './agent/AgentRunContext'
import { describeWithSqlite } from './testSupport/nativeSqlite'

const testDir = join(__dirname, '../../temp-memory-tool-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

const ctx = { reqId: 'req-1', signal: new AbortController().signal }

function stubRun(sessionId?: string): void {
  vi.spyOn(runCtx, 'getRun').mockReturnValue(
    sessionId ? ({ sessionId } as AgentRunContext) : ({ sessionId: undefined } as AgentRunContext)
  )
}

describeWithSqlite('remember / recall tools', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('remember stores a session memory bound to the run session', async () => {
    stubRun('sess-A')
    const res = await ToolRegistry.remember.execute(
      { content: 'prefers dark mode', scope: 'session', category: 'preference' },
      ctx
    )
    expect(res.resultForModel).toContain('session memory')
    const stored = getCurrentMemoryDoc({ scope: 'session', sessionId: 'sess-A' })
    expect(stored?.content).toContain('[preference] prefers dark mode')
    expect(stored?.version).toBe(1)
  })

  it('remember(scope=session) falls back to global when the run has no session', async () => {
    stubRun(undefined)
    const res = await ToolRegistry.remember.execute(
      { content: 'no session here', scope: 'session' },
      ctx
    )
    expect(res.resultForModel).toContain('global')
    expect(listMemoryDocs({ scope: 'global' })).toHaveLength(1)
  })

  it('remember rejects empty and oversized content', async () => {
    stubRun('sess-A')
    await expect(ToolRegistry.remember.execute({ content: '   ' }, ctx)).rejects.toThrow()
    await expect(
      ToolRegistry.remember.execute({ content: 'x'.repeat(5000) }, ctx)
    ).rejects.toThrow(/too long/)
  })

  it('recall returns both global and the current session, but not other sessions', async () => {
    stubRun('sess-A')
    await ToolRegistry.remember.execute({ content: 'global fact', scope: 'global' }, ctx)
    await ToolRegistry.remember.execute({ content: 'session A note', scope: 'session' }, ctx)
    stubRun('sess-B')
    await ToolRegistry.remember.execute({ content: 'session B note', scope: 'session' }, ctx)

    stubRun('sess-A')
    const res = await ToolRegistry.recall.execute({}, ctx)
    expect(res.resultForModel).toContain('global fact')
    expect(res.resultForModel).toContain('session A note')
    expect(res.resultForModel).not.toContain('session B note')
  })

  it('recall filters by query', async () => {
    stubRun('sess-A')
    await ToolRegistry.remember.execute({ content: 'likes coffee', scope: 'global' }, ctx)
    await ToolRegistry.remember.execute({ content: 'dislikes tea', scope: 'global' }, ctx)
    const res = await ToolRegistry.recall.execute({ query: 'coffee' }, ctx)
    expect(res.resultForModel).toContain('likes coffee')
    expect(res.resultForModel).toContain('dislikes tea')
  })

  it('recall reports when nothing is found', async () => {
    stubRun('sess-A')
    const res = await ToolRegistry.recall.execute({ query: 'nothing' }, ctx)
    expect(res.resultForModel).toContain('No memories found')
  })

  it('replace_memory_doc requires reading the current version first', async () => {
    stubRun('sess-A')
    const created = await ToolRegistry.replace_memory_doc.execute(
      {
        kind: 'soul',
        scope: 'global',
        key: 'assistant_profile',
        title: 'Assistant Profile',
        content: 'Name: 小白'
      },
      ctx
    )
    expect(created.resultForModel).toContain('v1')

    await expect(
      ToolRegistry.replace_memory_doc.execute(
        {
          kind: 'soul',
          scope: 'global',
          key: 'assistant_profile',
          content: 'Name: 小黑'
        },
        ctx
      )
    ).rejects.toThrow(/baseVersionId/)

    const read = await ToolRegistry.read_memory_doc.execute(
      { kind: 'soul', scope: 'global', key: 'assistant_profile' },
      ctx
    )
    const baseVersionId = read.resultForModel.match(/Version id: (memdoc_[^\n]+)/)?.[1]
    expect(baseVersionId).toBeTruthy()

    const updated = await ToolRegistry.replace_memory_doc.execute(
      {
        kind: 'soul',
        scope: 'global',
        key: 'assistant_profile',
        content: 'Name: 小黑',
        baseVersionId
      },
      ctx
    )
    expect(updated.resultForModel).toContain('v2')
    expect(listMemoryDocs({ kind: 'soul', scope: 'global', status: 'archived' })).toHaveLength(1)
  })
})
