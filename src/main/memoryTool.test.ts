import { vi, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { ToolRegistry } from './toolRegistry'
import { describeWithSqlite } from './testSupport/nativeSqlite'

// ToolRegistry transitively imports the sqlite-backed database module, so mock electron's
// userData path even though the new memory tools are file-based (they never touch the DB).
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'quickai-memtool-electron') }
}))

const ctx = { reqId: 'req-1', signal: new AbortController().signal }

let home: string

describeWithSqlite('file-based memory tools', () => {
  beforeEach(() => {
    home = join(tmpdir(), `quickai-memtool-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    process.env.QUICKAI_HOME = home
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.QUICKAI_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('write_memory creates a task group that read_memory can fetch', async () => {
    const res = await ToolRegistry.write_memory.execute(
      {
        target: 'task_group',
        group_name: 'QuickAI memory',
        content: 'scope: use when discussing memory\n\n## Reusable Knowledge\n- 常态记忆应短小'
      },
      ctx
    )
    expect(res.resultForModel).toContain('QuickAI memory')

    const read = await ToolRegistry.read_memory.execute({ target: 'QuickAI memory' }, ctx)
    expect(read.resultForModel).toContain('常态记忆应短小')
  })

  it('write_memory rejects empty content', async () => {
    await expect(
      ToolRegistry.write_memory.execute(
        { target: 'task_group', group_name: 'X', content: '  ' },
        ctx
      )
    ).rejects.toThrow()
  })

  it('write_memory(task_group) requires a group_name', async () => {
    await expect(
      ToolRegistry.write_memory.execute({ target: 'task_group', content: 'hello' }, ctx)
    ).rejects.toThrow(/group_name/)
  })

  it('write_memory(always) updates always.md', async () => {
    await ToolRegistry.write_memory.execute(
      { target: 'always', content: '# Always\n\n- 用户偏好中文' },
      ctx
    )
    const read = await ToolRegistry.read_memory.execute({ target: 'always' }, ctx)
    expect(read.resultForModel).toContain('用户偏好中文')
  })

  it('list_memory enumerates task groups', async () => {
    await ToolRegistry.write_memory.execute(
      { target: 'task_group', group_name: 'Alpha', content: 'scope: a\n\n## K\nx' },
      ctx
    )
    await ToolRegistry.write_memory.execute(
      { target: 'task_group', group_name: 'Beta', content: 'scope: b\n\n## K\ny' },
      ctx
    )
    const res = await ToolRegistry.list_memory.execute({}, ctx)
    expect(res.resultForModel).toContain('Alpha')
    expect(res.resultForModel).toContain('Beta')
  })

  it('read_memory reports when a task group is not found', async () => {
    const res = await ToolRegistry.read_memory.execute({ target: 'Nonexistent' }, ctx)
    expect(res.resultForModel).toContain('No Task Group named "Nonexistent"')
  })
})
