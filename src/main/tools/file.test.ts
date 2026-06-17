import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { fileTools } from './file'

const testDir = join(__dirname, '../../../temp-file-tools-test')

vi.mock('electron', () => ({
  Notification: {
    isSupported: () => false
  },
  app: {
    getPath: () => testDir
  }
}))

const executionContext = {
  reqId: 'file-tool-test',
  signal: new AbortController().signal,
  mainWindow: null as any
}

describe('fileTools', () => {
  let originalQuickAiHome: string | undefined
  let originalWorkspaceRoot: string | undefined

  beforeEach(async () => {
    originalQuickAiHome = process.env.QUICKAI_HOME
    originalWorkspaceRoot = process.env.QUICKAI_WORKSPACE_ROOT
    process.env.QUICKAI_HOME = testDir
    process.env.QUICKAI_WORKSPACE_ROOT = join(testDir, 'workspace')

    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
  })

  afterEach(async () => {
    if (originalQuickAiHome === undefined) delete process.env.QUICKAI_HOME
    else process.env.QUICKAI_HOME = originalQuickAiHome
    if (originalWorkspaceRoot === undefined) delete process.env.QUICKAI_WORKSPACE_ROOT
    else process.env.QUICKAI_WORKSPACE_ROOT = originalWorkspaceRoot
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('reports the total file line count in read metadata', async () => {
    await fs.writeFile(join(testDir, 'workspace', 'src', 'sample.ts'), 'one\ntwo\nthree', 'utf-8')

    const result = await fileTools.file_read.execute(
      { path: 'src/sample.ts', root: 'workspace', offset: 2, limit: 1 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 2 to 2 of 3')
    expect(result.resultForModel).toContain('Read Mode: offset')
    expect(result.resultForModel).toContain('Content:\ntwo')
  })

  it('supports tail reads', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'tail.ts'),
      ['one', 'two', 'three', 'four'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/tail.ts', root: 'workspace', tail: 2 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 3 to 4 of 4')
    expect(result.resultForModel).toContain('Read Mode: tail')
    expect(result.resultForModel).toContain('Content:\nthree\nfour')
  })

  it('supports negative offsets from the end of the file', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'negative.ts'),
      ['one', 'two', 'three', 'four'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/negative.ts', root: 'workspace', offset: -2, limit: 2 },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 3 to 4 of 4')
    expect(result.resultForModel).toContain('Read Mode: negative_offset')
    expect(result.resultForModel).toContain('Content:\nthree\nfour')
  })

  it('supports around reads with context and optional line numbers', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'around.ts'),
      ['one', 'two', 'three', 'four', 'five'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.file_read.execute(
      { path: 'src/around.ts', root: 'workspace', around: 3, context: 1, lineNumbers: true },
      executionContext
    )

    expect(result.resultForModel).toContain('Lines: 2 to 4 of 5')
    expect(result.resultForModel).toContain('Read Mode: around')
    expect(result.resultForModel).toContain('Line Numbers: included in content.')
    expect(result.resultForModel).toContain('2 | two')
    expect(result.resultForModel).toContain('3 | three')
    expect(result.resultForModel).toContain('4 | four')
  })

  it('locates a symbol in a provided file and returns its code block', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'logic.ts'),
      [
        'export function helper() {',
        '  return "helper"',
        '}',
        '',
        'export function targetFunction(value: number) {',
        '  const doubled = value * 2',
        '  return doubled',
        '}'
      ].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { path: 'src/logic.ts', root: 'workspace', symbol: 'targetFunction', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('Symbol: targetFunction')
    expect(result.resultForModel).toContain('File: src/logic.ts')
    expect(result.resultForModel).toContain('Definition Line: 5 of 8')
    expect(result.resultForModel).toContain('export function targetFunction(value: number) {')
    expect(result.resultForModel).toContain('return doubled')
    expect(result.resultForModel).not.toContain('return "helper"')
  })

  it('locates a symbol by scanning the workspace when no path is provided', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'service.py'),
      ['class Service:', '    def run(self):', '        return True'].join('\n'),
      'utf-8'
    )

    const result = await fileTools.code_symbol_read.execute(
      { root: 'workspace', symbol: 'run', contextLines: 0 },
      executionContext
    )

    expect(result.resultForModel).toContain('File: src/service.py')
    expect(result.resultForModel).toContain('Kind: python_function')
    expect(result.resultForModel).toContain('def run(self):')
    expect(result.resultForModel).toContain('return True')
  })

  it('returns a short diff after file_edit succeeds', async () => {
    const filePath = join(testDir, 'workspace', 'src', 'edit.ts')
    await fs.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8')

    await fileTools.file_read.execute({ path: 'src/edit.ts', root: 'workspace' }, executionContext)
    const result = await fileTools.file_edit.execute(
      { path: 'src/edit.ts', root: 'workspace', old_string: 'two', new_string: 'TWO' },
      executionContext
    )

    expect(result.resultForModel).toContain('Successfully edited src/edit.ts')
    expect(result.resultForModel).toContain('Diff:')
    expect(result.resultForModel).toContain('- two')
    expect(result.resultForModel).toContain('+ TWO')
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toContain('TWO')
  })

  it('adds location details when file_edit cannot find old_string', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'missing.ts'),
      ['function target() {', '  return 42', '}'].join('\n'),
      'utf-8'
    )

    await fileTools.file_read.execute(
      { path: 'src/missing.ts', root: 'workspace' },
      executionContext
    )
    await expect(
      fileTools.file_edit.execute(
        {
          path: 'src/missing.ts',
          root: 'workspace',
          old_string: 'return fortyTwo',
          new_string: 'return 43'
        },
        executionContext
      )
    ).rejects.toThrow(/Target preview: return fortyTwo[\s\S]*File length: 3 line\(s\)/)
  })

  it('adds match contexts when multi_edit old_string is ambiguous', async () => {
    await fs.writeFile(
      join(testDir, 'workspace', 'src', 'ambiguous.ts'),
      ['const value = 1', 'same', 'const value = 2', 'same'].join('\n'),
      'utf-8'
    )

    await fileTools.file_read.execute(
      { path: 'src/ambiguous.ts', root: 'workspace' },
      executionContext
    )
    await expect(
      fileTools.multi_edit.execute(
        {
          path: 'src/ambiguous.ts',
          root: 'workspace',
          edits: [{ old_string: 'same', new_string: 'changed' }]
        },
        executionContext
      )
    ).rejects.toThrow(/Match 1: lines 2-2[\s\S]*> 2 \| same[\s\S]*Match 2: lines 4-4/)
  })
})
