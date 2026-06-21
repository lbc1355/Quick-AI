import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { fileDeleteTool } from './fileDeleteTool'

const testDir = join(__dirname, '../../../temp-file-delete-tool-test')
const executionContext = {
  reqId: 'file-delete-tool-test',
  signal: new AbortController().signal
}

describe('fileDeleteTool', () => {
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

  it('deletes a workspace file and reports output metadata', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'delete-me.txt'), 'delete me', 'utf-8')

    const result = await fileDeleteTool.execute(
      { path: 'delete-me.txt', root: 'workspace' },
      executionContext
    )

    await expect(fs.stat(join(testDir, 'workspace', 'delete-me.txt'))).rejects.toThrow()
    expect(result.resultForModel).toContain('Deleted path: delete-me.txt')
    expect(result.resultForUi.title).toBe('Delete Path: delete-me.txt')
    expect(result.resultForUi.summary).toBe('Deleted delete-me.txt')
  })
})
