import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { directoryCreateTool } from './directoryCreateTool'
import { fileCopyTool } from './fileCopyTool'
import { fileDeleteTool } from './fileDeleteTool'
import { fileEditTool } from './fileEditTool'
import { fileMoveTool } from './fileMoveTool'
import { fileWriteTool } from './fileWriteTool'
import { multiEditTool } from './multiEditTool'

const executionContext = {
  reqId: 'file-mutation-tools-test',
  signal: new AbortController().signal
}

describe('workspace file mutation tools', () => {
  let testDir: string
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    testDir = await fs.mkdtemp(join(tmpdir(), 'quickai-file-mutation-test-'))
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
  })

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot

    await fs.rm(testDir, { recursive: true, force: true })
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
    expect(result.resultForModel).toContain('Diff:')
    expect(result.resultForModel).toContain('- two')
    expect(result.resultForModel).toContain('+ TWO')
    expect(result.resultForUi.summary).toContain('Replaced 1 occurrence')
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
