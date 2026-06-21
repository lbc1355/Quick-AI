import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { workspaceSearchTool } from './workspaceSearchTool'

const testDir = join(__dirname, '../../../temp-workspace-search-tool-test')
const executionContext = {
  reqId: 'workspace-search-tool-test',
  signal: new AbortController().signal
}

describe('workspaceSearchTool', () => {
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
    await fs.mkdir(join(testDir, 'workspace', 'node_modules'), { recursive: true })
    await fs.writeFile(join(testDir, 'workspace', 'src', 'main.ts'), 'const value = "search-needle"\n')
    await fs.writeFile(join(testDir, 'workspace', 'node_modules', 'ignored.ts'), 'search-needle\n')
  })

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('searches workspace files and returns UI result items', async () => {
    const result = await workspaceSearchTool.execute(
      { query: 'search-needle', glob: 'src/**/*.ts', root: 'workspace' },
      executionContext
    )

    const normalizedModel = result.resultForModel.replace(/\\/g, '/')
    const normalizedTitle = result.resultForUi.items![0].title.replace(/\\/g, '/')

    expect(normalizedModel).toContain('File: src/main.ts')
    expect(result.resultForUi.title).toBe('Workspace Search: "search-needle"')
    expect(result.resultForUi.items).toHaveLength(1)
    expect(normalizedTitle).toBe('src/main.ts Line 1')
  })
})
