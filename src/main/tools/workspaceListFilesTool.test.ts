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
    await fs.mkdir(join(testDir, 'workspace', 'src'), { recursive: true })
    await fs.mkdir(join(testDir, 'workspace', '.venv', 'Lib', 'site-packages', 'pkg'), {
      recursive: true
    })
    await fs.mkdir(join(testDir, 'workspace', 'site-packages', 'pkg'), { recursive: true })
    await fs.writeFile(join(testDir, 'workspace', 'docs', 'readme.md'), '# readme\n')
    await fs.writeFile(join(testDir, 'workspace', 'docs', 'notes.txt'), 'notes\n')
    await fs.writeFile(join(testDir, 'workspace', 'src', 'app.py'), 'print("ok")\n')
    await fs.writeFile(
      join(testDir, 'workspace', '.venv', 'Lib', 'site-packages', 'pkg', 'hidden.py'),
      'print("ignored")\n'
    )
    await fs.writeFile(
      join(testDir, 'workspace', 'site-packages', 'pkg', 'also-hidden.py'),
      'print("ignored")\n'
    )
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
  it('skips common virtualenv and cache directories by default and reports them', async () => {
    const result = await workspaceListFilesTool.execute(
      { glob: '**/*.py', root: 'workspace' },
      executionContext
    )

    expect(result.resultForModel).toContain('File: src/app.py')
    expect(result.resultForModel).not.toContain('hidden.py')
    expect(result.resultForModel).toContain('Default ignored directories:')
    expect(result.resultForModel).toContain('.venv')
    expect(result.resultForModel).toContain('site-packages')
    expect(result.resultForModel).toContain(
      '[Info: Skipped ignored directories during this scan: .venv, site-packages]'
    )
  })

  it('can include ignored directories when explicitly requested', async () => {
    const result = await workspaceListFilesTool.execute(
      { glob: '**/*.py', root: 'workspace', includeIgnoredDirectories: true },
      executionContext
    )

    expect(result.resultForModel).toContain('File: src/app.py')
    expect(result.resultForModel).toContain('.venv/Lib/site-packages/pkg/hidden.py')
    expect(result.resultForModel).toContain('site-packages/pkg/also-hidden.py')
    expect(result.resultForModel).not.toContain('Default ignored directories:')
  })
})
