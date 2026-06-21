import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { multiEditTool } from './multiEditTool'

const testDir = join(__dirname, '../../../temp-multi-edit-tool-test')
const executionContext = {
  reqId: 'multi-edit-tool-test',
  signal: new AbortController().signal
}

describe('multiEditTool', () => {
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

  it('applies sequential replacements atomically and reports the total replacements', async () => {
    const filePath = join(testDir, 'workspace', 'src', 'batch.ts')
    await fs.writeFile(filePath, 'alpha beta gamma', 'utf-8')

    const result = await multiEditTool.execute(
      {
        path: 'src/batch.ts',
        root: 'workspace',
        edits: [
          { old_string: 'alpha', new_string: 'ALPHA' },
          { old_string: 'beta', new_string: 'BETA' }
        ]
      },
      executionContext
    )

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('ALPHA BETA gamma')
    expect(result.resultForModel).toContain('Successfully applied 2 edit(s) to src/batch.ts')
    expect(result.resultForModel).toContain('2 total replacement(s)')
    expect(result.resultForUi.summary).toContain('Applied 2 edit(s)')
  })
})
