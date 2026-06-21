import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { directoryCreateTool } from './directoryCreateTool'

const testDir = join(__dirname, '../../../temp-directory-create-tool-test')
const executionContext = {
  reqId: 'directory-create-tool-test',
  signal: new AbortController().signal
}

describe('directoryCreateTool', () => {
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace'), { recursive: true })
  })

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('creates a workspace directory and reports output metadata', async () => {
    const result = await directoryCreateTool.execute(
      { path: 'generated/nested', root: 'workspace' },
      executionContext
    )

    const stats = await fs.stat(join(testDir, 'workspace', 'generated', 'nested'))
    expect(stats.isDirectory()).toBe(true)
    expect(result.resultForModel).toContain('Created directory: generated/nested')
    expect(result.resultForUi.title).toBe('Create Directory: generated/nested')
    expect(result.resultForUi.summary).toContain('Created directory generated/nested')
  })
})
