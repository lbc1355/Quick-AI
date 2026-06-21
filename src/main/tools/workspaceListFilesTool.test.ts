import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { workspaceListFilesTool } from './workspaceListFilesTool'

const testDir = join(__dirname, '../../../temp-workspace-list-files-tool-test')
const executionContext = {
  reqId: 'workspace-list-files-tool-test',
  signal: new AbortController().signal
}

describe('workspaceListFilesTool', () => {
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace', 'docs'), { recursive: true })
    await fs.writeFile(join(testDir, 'workspace', 'docs', 'readme.md'), '# readme\n')
    await fs.writeFile(join(testDir, 'workspace', 'docs', 'notes.txt'), 'notes\n')
  })

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('lists matching workspace files and returns UI result items', async () => {
    const result = await workspaceListFilesTool.execute(
      { glob: 'docs/**/*.md', root: 'workspace' },
      executionContext
    )

    expect(result.resultForModel).toContain('File: docs/readme.md')
    expect(result.resultForUi.title).toBe('List Files: "docs/**/*.md"')
    expect(result.resultForUi.items).toHaveLength(1)
    expect(result.resultForUi.items![0].title).toBe('docs/readme.md')
  })
})
