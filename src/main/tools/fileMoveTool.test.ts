import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { fileMoveTool } from './fileMoveTool'

const testDir = join(__dirname, '../../../temp-file-move-tool-test')
const executionContext = {
  reqId: 'file-move-tool-test',
  signal: new AbortController().signal
}

describe('fileMoveTool', () => {
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

  it('moves a workspace file and creates destination parent directories', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'source.txt'), 'move source', 'utf-8')

    const result = await fileMoveTool.execute(
      {
        sourcePath: 'source.txt',
        destinationPath: 'nested/moved.txt',
        root: 'workspace'
      },
      executionContext
    )

    await expect(fs.stat(join(testDir, 'workspace', 'source.txt'))).rejects.toThrow()
    await expect(
      fs.readFile(join(testDir, 'workspace', 'nested', 'moved.txt'), 'utf-8')
    ).resolves.toBe('move source')
    expect(result.resultForModel).toContain('Moved path:')
    expect(result.resultForUi.title).toBe('Move Path: source.txt')
    expect(result.resultForUi.summary).toContain('Moved source.txt to nested/moved.txt')
  })
})
