import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { fileEditTool } from './fileEditTool'

const testDir = join(__dirname, '../../../temp-file-edit-tool-test')
const executionContext = {
  reqId: 'file-edit-tool-test',
  signal: new AbortController().signal
}

describe('fileEditTool', () => {
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
  })

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('replaces one exact match and returns a short diff', async () => {
    const filePath = join(testDir, 'workspace', 'src', 'edit.ts')
    await fs.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8')

    const result = await fileEditTool.execute(
      {
        path: 'src/edit.ts',
        root: 'workspace',
        old_string: 'two',
        new_string: 'TWO'
      },
      executionContext
    )

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('one\nTWO\nthree')
    expect(result.resultForModel).toContain('Successfully edited src/edit.ts')
    expect(result.resultForModel).toContain('- two')
    expect(result.resultForModel).toContain('+ TWO')
    expect(result.resultForUi.summary).toContain('Replaced 1 occurrence')
  })
})
