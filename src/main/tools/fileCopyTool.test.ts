import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { fileCopyTool } from './fileCopyTool'

const testDir = join(__dirname, '../../../temp-file-copy-tool-test')
const executionContext = {
  reqId: 'file-copy-tool-test',
  signal: new AbortController().signal
}

describe('fileCopyTool', () => {
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

  it('copies a workspace file and creates destination parent directories', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'source.txt'), 'copy source', 'utf-8')

    const result = await fileCopyTool.execute(
      {
        sourcePath: 'source.txt',
        destinationPath: 'nested/copied.txt',
        root: 'workspace'
      },
      executionContext
    )

    await expect(
      fs.readFile(join(testDir, 'workspace', 'nested', 'copied.txt'), 'utf-8')
    ).resolves.toBe('copy source')
    expect(result.resultForModel).toContain('Copied file:')
    expect(result.resultForUi.title).toBe('Copy File: source.txt')
    expect(result.resultForUi.summary).toContain('Copied source.txt to nested/copied.txt')
  })
})
