import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync, readFileSync } from 'fs'
import {
  ensureMemoryLibrary,
  getMemoryFilePaths,
  parseTaskGroups,
  writeTaskGroup,
  listTaskGroups,
  getTaskGroup,
  readSummaryIndex,
  appendRaw,
  readRaw,
  listMemoryEntries,
  readMemoryEntry,
  writeMemoryEntry
} from './memoryStore'

let home: string

beforeEach(() => {
  home = join(tmpdir(), `quickai-memstore-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  process.env.QUICKAI_HOME = home
})

afterEach(() => {
  delete process.env.QUICKAI_HOME
  rmSync(home, { recursive: true, force: true })
})

describe('parseTaskGroups', () => {
  it('splits MEMORY.md into groups and extracts scope', () => {
    const md = `# Task Group: Alpha
scope: use when doing alpha

## Keywords
a, b

# Task Group: Beta
scope: use when doing beta

## Notes
hi`
    const groups = parseTaskGroups(md)
    expect(groups).toHaveLength(2)
    expect(groups[0].name).toBe('Alpha')
    expect(groups[0].scope).toBe('use when doing alpha')
    expect(groups[1].name).toBe('Beta')
    expect(groups[1].raw).toContain('## Notes')
  })

  it('returns empty for content with no task group headers', () => {
    expect(parseTaskGroups('just some text\n## heading')).toHaveLength(0)
  })
})

describe('ensureMemoryLibrary', () => {
  it('creates the directory skeleton and seed files', async () => {
    await ensureMemoryLibrary()
    const p = getMemoryFilePaths()
    expect(existsSync(p.always)).toBe(true)
    expect(existsSync(p.summary)).toBe(true)
    expect(existsSync(p.memory)).toBe(true)
    expect(existsSync(p.raw)).toBe(true)
    expect(existsSync(p.rolloutDir)).toBe(true)
  })
})

describe('writeTaskGroup', () => {
  it('inserts a group, refreshes the index, and round-trips', async () => {
    await writeTaskGroup(
      'QuickAI memory',
      `scope: use when discussing memory

## Reusable Knowledge
- 常态记忆应短小稳定`
    )
    const groups = listTaskGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('QuickAI memory')

    const fetched = getTaskGroup('quickai memory')
    expect(fetched?.raw).toContain('常态记忆应短小稳定')
    expect(fetched?.raw.startsWith('# Task Group: QuickAI memory')).toBe(true)

    // summary index regenerated from the group
    expect(readSummaryIndex()).toContain('QuickAI memory')
  })

  it('replaces an existing group rather than duplicating it', async () => {
    await writeTaskGroup('Alpha', 'scope: v1\n\n## X\nold')
    await writeTaskGroup('Alpha', 'scope: v2\n\n## X\nnew')
    const groups = listTaskGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].scope).toBe('v2')
    expect(groups[0].raw).toContain('new')
    expect(groups[0].raw).not.toContain('old')
  })
})

describe('appendRaw', () => {
  it('appends to raw_memories.md', async () => {
    await appendRaw('first sediment')
    await appendRaw('second sediment')
    const raw = readRaw()
    expect(raw).toContain('first sediment')
    expect(raw).toContain('second sediment')
  })
})

describe('file-browser API', () => {
  it('lists entries and round-trips edits, regenerating the index on MEMORY.md edit', async () => {
    const entries = await listMemoryEntries()
    const ids = entries.map((e) => e.id)
    expect(ids).toContain('always')
    expect(ids).toContain('memory')

    await writeMemoryEntry('always', '# Always\n\n- 用户偏好中文')
    expect(readMemoryEntry('always')).toContain('用户偏好中文')

    await writeMemoryEntry('memory', '# Task Group: Gamma\nscope: g\n\n## K\nstuff')
    const p = getMemoryFilePaths()
    expect(readFileSync(p.summary, 'utf8')).toContain('Gamma')
  })

  it('rejects unknown entry ids on write', async () => {
    await expect(writeMemoryEntry('../escape', 'x')).rejects.toThrow(/Unknown memory entry/)
  })
})
