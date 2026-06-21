import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { fileWriteTool } from './fileWriteTool'

const testDir = join(__dirname, '../../../temp-file-write-tool-test')
const executionContext = {
  reqId: 'file-write-tool-test',
  signal: new AbortController().signal
}

describe('fileWriteTool', () => {
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

  it('writes a new workspace file and reports created output metadata', async () => {
    const result = await fileWriteTool.execute(
      {
        path: 'notes/result.txt',
        root: 'workspace',
        content: 'hello from file_write',
        mode: 'create',
        createDirs: true
      },
      executionContext
    )

    await expect(
      fs.readFile(join(testDir, 'workspace', 'notes', 'result.txt'), 'utf-8')
    ).resolves.toBe('hello from file_write')
    expect(result.resultForModel).toContain('Successfully wrote file: notes/result.txt')
    expect(result.resultForUi.title).toBe('Write File: notes/result.txt')
    expect(result.resultForUi.summary).toContain('created')
  })
})
