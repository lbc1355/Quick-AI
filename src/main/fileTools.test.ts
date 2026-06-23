import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import {
  isPathInWorkspace,
  isSensitiveFile,
  ToolRegistry,
  getWorkspaceRoot,
  searchToolDefinitions
} from './toolRegistry'

describe('File Safety & Search Tools', () => {
  const workspaceRoot = getWorkspaceRoot()
  const testDir = join(workspaceRoot, 'temp-file-test-dir')
  const projectRoot = resolve(workspaceRoot, '..', 'quickai-filetools-project')
  const extraRoot = resolve(workspaceRoot, '..', 'quickai-filetools-extra')

  // Use concatenated strings so the test file itself does not contain the literal search terms
  const queryStr = 'uniqueMatch' + 'QueryStringForTestingFileTools'
  const queryStrUpper = queryStr.toUpperCase()

  beforeAll(async () => {
    // Set up a temporary folder structure within the workspace for testing
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.rm(projectRoot, { recursive: true, force: true })
    await fs.rm(extraRoot, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
    await fs.mkdir(projectRoot, { recursive: true })
    await fs.mkdir(extraRoot, { recursive: true })
    await fs.mkdir(join(testDir, 'sub'), { recursive: true })
    await fs.mkdir(join(testDir, 'sub', 'deep'), { recursive: true })
    await fs.mkdir(join(testDir, 'node_modules'), { recursive: true })
    await fs.mkdir(join(testDir, 'src'), { recursive: true })
    await fs.mkdir(join(testDir, '__tests__'), { recursive: true })

    await fs.writeFile(join(testDir, 'a.txt'), `line1\nline2\n${queryStr}\nline4`)
    await fs.writeFile(join(testDir, 'b.log'), `${queryStr}\nline2\n${queryStrUpper}`)
    await fs.writeFile(join(testDir, 'root.ts'), `${queryStr}`)
    await fs.writeFile(
      join(testDir, 'symbols.ts'),
      `export function targetFn() {\n  return 'ok'\n}\n`
    )
    await fs.writeFile(
      join(testDir, 'src', 'rankedDuplicate.ts'),
      `export function rankedDuplicateSymbol() {\n  return 'source'\n}\n`
    )
    await fs.writeFile(
      join(testDir, '__tests__', 'rankedDuplicate.test.ts'),
      `export function rankedDuplicateSymbol() {\n  return 'test'\n}\n`
    )
    await fs.writeFile(join(testDir, 'sub', 'c.ts'), `other\n${queryStr}`)
    await fs.writeFile(join(testDir, 'sub', 'deep', 'd.ts'), `${queryStr}`)
    await fs.writeFile(join(testDir, 'sub', 'sensitive.key'), 'secret')
    await fs.writeFile(join(testDir, '.env'), 'SECRET_KEY=123')
    await fs.writeFile(join(testDir, 'node_modules', 'ignored.txt'), queryStr)
    await fs.writeFile(join(projectRoot, 'project-read.txt'), 'project readable content')
    await fs.writeFile(join(projectRoot, 'project-diff.txt'), queryStr)
    await fs.writeFile(join(extraRoot, 'extra-read.txt'), 'extra readable content with extraNeedle')
  })

  afterAll(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  describe('isPathInWorkspace', () => {
    it('allows files inside the workspace root', () => {
      expect(isPathInWorkspace(join(testDir, 'a.txt'))).toBe(true)
      expect(isPathInWorkspace(join(testDir, 'sub', 'c.ts'))).toBe(true)
    })

    it('blocks directory traversal outside the workspace root', () => {
      const outsidePath = resolve(workspaceRoot, '..', 'some-other-file.txt')
      expect(isPathInWorkspace(outsidePath)).toBe(false)
    })
  })

  describe('isSensitiveFile', () => {
    it('blocks environment config files', () => {
      expect(isSensitiveFile(join(testDir, '.env'))).toBe(true)
      expect(isSensitiveFile(join(testDir, '.env.local'))).toBe(true)
      expect(isSensitiveFile(join(testDir, '.env.production'))).toBe(true)
    })

    it('blocks private key files and certificates', () => {
      expect(isSensitiveFile(join(testDir, 'id_rsa'))).toBe(true)
      expect(isSensitiveFile(join(testDir, 'sub', 'sensitive.key'))).toBe(true)
      expect(isSensitiveFile(join(testDir, 'cert.pem'))).toBe(true)
      expect(isSensitiveFile(join(testDir, 'client.pfx'))).toBe(true)
    })

    it('allows normal files', () => {
      expect(isSensitiveFile(join(testDir, 'a.txt'))).toBe(false)
      expect(isSensitiveFile(join(testDir, 'sub', 'c.ts'))).toBe(false)
    })
  })

  describe('file_read tool', () => {
    it('reads complete file contents with offset and limit', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.file_read.execute(
        { path: join(testDir, 'a.txt'), offset: 2, limit: 2 },
        context
      )

      expect(res.resultForModel).toContain(`line2\n${queryStr}`)
      expect(res.resultForModel).toContain('Lines: 2 to 3 of 4')
      expect(res.resultForUi.title).toBe(`Read File: temp-file-test-dir/a.txt`)
      expect(res.resultForUi.details).toContain(`line2\n${queryStr}`)
    })

    it('rejects reading outside workspace', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const outsidePath = resolve(workspaceRoot, '..', 'traversal.txt')

      await expect(ToolRegistry.file_read.execute({ path: outsidePath }, context)).rejects.toThrow(
        'outside the global workspace and current project root'
      )
    })

    it('adds an extra root and permits file tools under it across runs', async () => {
      const { createRun, destroyRun, clearSessionApprovals } =
        await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const sessionId = 'test-session-extra-root'
      const reqId = 'test-req-extra-root-1'
      clearSessionApprovals(sessionId)
      createRun(reqId, [], 'all', new ActionLog(), undefined, sessionId)

      try {
        const context = { reqId, signal: new AbortController().signal }
        const addResult = await ToolRegistry.workspace_add_root.execute(
          { path: extraRoot, label: 'Extra Project' },
          context
        )
        expect(addResult.resultForModel).toContain(extraRoot)

        const readResult = await ToolRegistry.file_read.execute(
          { path: join(extraRoot, 'extra-read.txt') },
          context
        )
        expect(readResult.resultForModel).toContain('extra readable content')
        expect(readResult.resultForModel).toContain('Root (extra):')

        const listResult = await ToolRegistry.workspace_list_files.execute(
          { path: extraRoot, glob: '**/*.txt' },
          context
        )
        expect(listResult.resultForModel).toContain('extra-read.txt')

        const searchResult = await ToolRegistry.workspace_search.execute(
          { path: extraRoot, query: 'extraNeedle' },
          context
        )
        expect(searchResult.resultForModel).toContain('extra-read.txt')
      } finally {
        destroyRun(reqId)
      }

      const nextReqId = 'test-req-extra-root-2'
      createRun(nextReqId, [], 'all', new ActionLog(), undefined, sessionId)
      try {
        const inheritedRead = await ToolRegistry.file_read.execute(
          { path: join(extraRoot, 'extra-read.txt') },
          { reqId: nextReqId, signal: new AbortController().signal }
        )
        expect(inheritedRead.resultForModel).toContain('extra readable content')
      } finally {
        destroyRun(nextReqId)
        clearSessionApprovals(sessionId)
      }
    })

    it('permits reading inside the current project root when run context is active', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-read-run'
      createRun(
        reqId,
        [],
        'all',
        new ActionLog(),
        undefined,
        undefined,
        projectRoot,
        'Test Project'
      )

      const context = { reqId, signal: new AbortController().signal }

      try {
        const res = await ToolRegistry.file_read.execute({ path: 'project-read.txt' }, context)
        expect(res.resultForModel).toContain('project readable content')
        expect(res.resultForModel).toContain(`Root (project): ${projectRoot}`)
      } finally {
        destroyRun(reqId)
      }
    })

    it('rejects reading sensitive files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      await expect(
        ToolRegistry.file_read.execute({ path: join(testDir, '.env') }, context)
      ).rejects.toThrow('sensitive file')
    })
  })

  describe('code_symbol_read tool', () => {
    it('returns symbol details for UI inspection', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.code_symbol_read.execute(
        { symbol: 'targetFn', path: join(testDir, 'symbols.ts') },
        context
      )

      expect(res.resultForModel).toContain('Symbol: targetFn')
      expect(res.resultForUi.title).toBe('Code Symbol: targetFn')
      expect(res.resultForUi.details).toContain("return 'ok'")
    })

    it('ranks source symbols before test candidates and exposes ambiguity', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-code-symbol-rank'
      createRun(reqId, [], 'all', new ActionLog(), undefined, undefined, testDir, 'Test Project')
      const context = { reqId, signal: new AbortController().signal }

      try {
        const res = await ToolRegistry.code_symbol_read.execute(
          { symbol: 'rankedDuplicateSymbol', root: 'project' },
          context
        )

        expect(res.resultForModel).toContain('File: src/rankedDuplicate.ts')
        expect(res.resultForModel).toContain('Selection Reason:')
        expect(res.resultForModel).toContain('Candidates:')
        expect(res.resultForUi.summary).toContain('2 candidates')
        expect(res.resultForUi.items?.map((item) => item.title)).toEqual([
          'src/rankedDuplicate.ts:1 (function)',
          '__tests__/rankedDuplicate.test.ts:1 (function)'
        ])
      } finally {
        destroyRun(reqId)
      }
    })
  })

  describe('workspace_search tool', () => {
    it('searches workspace and ignores node_modules', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_search.execute({ query: queryStr }, context)

      // matches: 1 in a.txt, 2 in b.log, 1 in root.ts, 1 in c.ts, 1 in d.ts (ignored.txt in node_modules is skipped)
      expect(res.resultForUi.items).toHaveLength(6)
      const paths = res.resultForUi.items?.map((item) => item.title) || []
      expect(paths.some((p) => p.includes('a.txt'))).toBe(true)
      expect(paths.some((p) => p.includes('b.log'))).toBe(true)
      expect(paths.some((p) => p.includes('c.ts'))).toBe(true)
      expect(paths.some((p) => p.includes('ignored.txt'))).toBe(false)
    })

    it('filters search by glob pattern', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_search.execute(
        { query: queryStr, glob: '*.txt' },
        context
      )

      expect(res.resultForUi.items).toHaveLength(1)
      expect(res.resultForUi.items![0].title).toContain('a.txt')
    })

    it('respects caseSensitivity option', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      // Case insensitive (default) - should match 6 lines across a.txt, b.log, root.ts, c.ts, d.ts
      const resInsensitive = await ToolRegistry.workspace_search.execute(
        { query: queryStrUpper },
        context
      )
      expect(resInsensitive.resultForUi.items).toHaveLength(6)

      // Case sensitive - should only match 1 line in b.log
      const resSensitive = await ToolRegistry.workspace_search.execute(
        { query: queryStrUpper, caseSensitive: true },
        context
      )
      expect(resSensitive.resultForUi.items).toHaveLength(1)
      expect(resSensitive.resultForUi.items![0].title).toContain('b.log')
    })

    it('caps results to maxResults option', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_search.execute(
        { query: queryStr, maxResults: 2 },
        context
      )

      expect(res.resultForUi.items).toHaveLength(2)
    })

    it('escapes special regex characters in search query without crashing', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      // Each of these contains regex metacharacters that previously crashed or matched incorrectly
      for (const q of ['*', 'fetch_url?', 'a+b', '[test]']) {
        await expect(
          ToolRegistry.workspace_search.execute({ query: q }, context)
        ).resolves.toBeDefined()
      }
    })

    it('supports ** glob for recursive directory matching', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_search.execute(
        { query: queryStr, glob: 'temp-file-test-dir/**/*.ts' },
        context
      )
      const paths = res.resultForUi.items?.map((item) => item.title) || []
      // ** should match zero-or-more directory levels
      expect(paths.some((p) => p.includes('root.ts'))).toBe(true)
      expect(paths.some((p) => p.includes('c.ts'))).toBe(true)
      expect(paths.some((p) => p.includes('d.ts'))).toBe(true)
    })

    it('truncates long matched lines to 300 characters', async () => {
      const longLineFile = join(testDir, 'long-line.txt')
      const longLine = queryStr + 'X'.repeat(500)
      await fs.writeFile(longLineFile, longLine)
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      try {
        const res = await ToolRegistry.workspace_search.execute(
          { query: queryStr, glob: 'temp-file-test-dir/long-line.txt' },
          context
        )
        expect(res.resultForUi.items).toHaveLength(1)
        expect(res.resultForModel).toContain('...')
        expect(res.resultForModel).not.toContain('X'.repeat(500))
      } finally {
        await fs.unlink(longLineFile).catch(() => {})
      }
    })

    it('caps total result text at 25000 characters', async () => {
      const manyMatchesFile = join(testDir, 'many-matches.txt')
      const lines = Array.from({ length: 500 }, (_, i) => `${queryStr} line ${i}`)
      await fs.writeFile(manyMatchesFile, lines.join('\n'))
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      try {
        const res = await ToolRegistry.workspace_search.execute(
          { query: queryStr, glob: 'temp-file-test-dir/many-matches.txt', maxResults: 500 },
          context
        )
        // 25000 + truncation notice
        expect(res.resultForModel.length).toBeLessThanOrEqual(25200)
        expect(res.resultForModel).toContain('[Results truncated')
      } finally {
        await fs.unlink(manyMatchesFile).catch(() => {})
      }
    })

    it('blocks reading files outside workspace via symbolic link', async () => {
      const symlinkPath = join(testDir, 'symlink-outside.txt')
      const targetOutsideFile = resolve(workspaceRoot, '..', 'temp-outside-target.txt')

      try {
        await fs.writeFile(targetOutsideFile, 'outside data')
        await fs.symlink(targetOutsideFile, symlinkPath, 'file')
      } catch (e) {
        // If symlink creation is not supported/permitted on this OS/user, skip the test gracefully
        console.warn('Skipping symlink test due to OS restrictions:', (e as Error).message)
        try {
          await fs.unlink(targetOutsideFile)
        } catch {
          // Ignore cleanup error
        }
        return
      }

      const context = { reqId: 'test-req', signal: new AbortController().signal }

      try {
        await expect(
          ToolRegistry.file_read.execute({ path: symlinkPath }, context)
        ).rejects.toThrow('outside the global workspace and current project root')
      } finally {
        try {
          await fs.unlink(symlinkPath)
        } catch {
          // Ignore cleanup error
        }
        try {
          await fs.unlink(targetOutsideFile)
        } catch {
          // Ignore cleanup error
        }
      }
    })

    it('rejects reading files exceeding size limit', async () => {
      const largeFilePath = join(testDir, 'large-file.txt')
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      const data = 'A'.repeat(2.1 * 1024 * 1024) // 2.1MB
      await fs.writeFile(largeFilePath, data)

      try {
        await expect(
          ToolRegistry.file_read.execute({ path: largeFilePath }, context)
        ).rejects.toThrow('File is too large')
      } finally {
        try {
          await fs.unlink(largeFilePath)
        } catch {
          // Ignore cleanup error
        }
      }
    })

    it('ignores files exceeding size limit or binary extensions in search', async () => {
      const largeSearchFile = join(testDir, 'large-search.txt')
      const pngFile = join(testDir, 'image.png')
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      await fs.writeFile(largeSearchFile, queryStr + '\n' + 'B'.repeat(600 * 1024))
      await fs.writeFile(pngFile, queryStr)

      try {
        const res = await ToolRegistry.workspace_search.execute({ query: queryStr }, context)
        const paths = res.resultForUi.items?.map((item) => item.title) || []
        expect(paths.some((p) => p.includes('large-search.txt'))).toBe(false)
        expect(paths.some((p) => p.includes('image.png'))).toBe(false)
      } finally {
        try {
          await fs.unlink(largeSearchFile)
        } catch {
          // Ignore cleanup error
        }
        try {
          await fs.unlink(pngFile)
        } catch {
          // Ignore cleanup error
        }
      }
    })

    it('handles search timeouts and reports scan truncation', async () => {
      const originalNow = Date.now
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        const stack = new Error().stack || ''
        if (stack.includes('walk')) {
          return originalNow() + 15000
        }
        return originalNow()
      })

      try {
        const context = { reqId: 'test-req', signal: new AbortController().signal }
        const res = await ToolRegistry.workspace_search.execute({ query: queryStr }, context)
        expect(res.resultForModel).toContain(
          '[Warning: Search scan was truncated. Reason: Time limit exceeded]'
        )
        expect(res.resultForUi.summary).toContain('Scan truncated: Time limit exceeded')
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('logs and displays workspace root in file_read and workspace_search', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const resSearch = await ToolRegistry.workspace_search.execute({ query: queryStr }, context)
      expect(resSearch.resultForModel).toContain(`Root (workspace): ${workspaceRoot}`)
      expect(resSearch.resultForUi.summary).toContain(workspaceRoot)

      const resRead = await ToolRegistry.file_read.execute(
        { path: join(testDir, 'a.txt') },
        context
      )
      expect(resRead.resultForModel).toContain(`Root (workspace): ${workspaceRoot}`)
      expect(resRead.resultForUi.summary).toContain(workspaceRoot)
    })
  })

  describe('workspace_list_files tool', () => {
    it('lists matching files inside workspace', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_list_files.execute(
        { glob: 'temp-file-test-dir/**/*.txt' },
        context
      )
      expect(res.resultForUi.items).toHaveLength(1)
      expect(res.resultForUi.items![0].title).toBe('temp-file-test-dir/a.txt')
      expect(res.resultForModel).toContain('File: temp-file-test-dir/a.txt')
    })

    it('rejects listing symbolic links or sensitive files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_list_files.execute(
        { glob: 'temp-file-test-dir/**' },
        context
      )
      const paths = res.resultForUi.items?.map((i) => i.title) || []
      expect(paths.some((p) => p.includes('.env'))).toBe(false)
      expect(paths.some((p) => p.includes('sensitive.key'))).toBe(false)
    })
  })

  describe('file_write tool', () => {
    it('writes content to a new file and creates parent directories', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const targetPath = join(testDir, 'new-sub-dir', 'written.txt')
      try {
        const res = await ToolRegistry.file_write.execute(
          {
            path: targetPath,
            content: 'hello world from test',
            mode: 'create',
            createDirs: true
          },
          context
        )

        expect(res.resultForUi.summary).toContain('created')
        const readContent = await fs.readFile(targetPath, 'utf-8')
        expect(readContent).toBe('hello world from test')
      } finally {
        await fs.unlink(targetPath).catch(() => {})
        await fs.rm(join(testDir, 'new-sub-dir'), { recursive: true, force: true }).catch(() => {})
      }
    })

    it('overwrites file content when mode is overwrite', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const targetPath = join(testDir, 'overwrite-test.txt')
      await fs.writeFile(targetPath, 'original content')
      try {
        // mode create should throw an error
        await expect(
          ToolRegistry.file_write.execute(
            {
              path: targetPath,
              content: 'new content',
              mode: 'create'
            },
            context
          )
        ).rejects.toThrow('already exists')

        // mode overwrite should succeed
        const res = await ToolRegistry.file_write.execute(
          {
            path: targetPath,
            content: 'new content',
            mode: 'overwrite'
          },
          context
        )

        expect(res.resultForUi.summary).toContain('overwrote')
        const readContent = await fs.readFile(targetPath, 'utf-8')
        expect(readContent).toBe('new content')
      } finally {
        await fs.unlink(targetPath).catch(() => {})
      }
    })

    it('rejects writing outside workspace or to sensitive files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const outsidePath = resolve(workspaceRoot, '..', 'should-fail-write.txt')
      await expect(
        ToolRegistry.file_write.execute(
          {
            path: outsidePath,
            content: 'fails'
          },
          context
        )
      ).rejects.toThrow('outside the global workspace and current project root')

      const sensitivePath = join(testDir, '.env')
      await expect(
        ToolRegistry.file_write.execute(
          {
            path: sensitivePath,
            content: 'fails',
            mode: 'overwrite'
          },
          context
        )
      ).rejects.toThrow('sensitive file')
    })

    it('permits writing inside the current project root when run context is active', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-write-run'
      createRun(
        reqId,
        [],
        'all',
        new ActionLog(),
        undefined,
        undefined,
        projectRoot,
        'Test Project'
      )

      const context = { reqId, signal: new AbortController().signal }
      const projectFile = join(projectRoot, 'project-write.txt')

      try {
        const res = await ToolRegistry.file_write.execute(
          {
            path: 'project-write.txt',
            content: 'project writable content',
            mode: 'create'
          },
          context
        )
        expect(res.resultForUi.summary).toContain('created')
        const readContent = await fs.readFile(projectFile, 'utf-8')
        expect(readContent).toBe('project writable content')
      } finally {
        destroyRun(reqId)
        await fs.unlink(projectFile).catch(() => {})
      }
    })
  })

  describe('file_edit tool', () => {
    it('edits a file within the workspace', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const filePath = join(testDir, 'root.ts')
      const res = await ToolRegistry.file_edit.execute(
        {
          path: filePath,
          old_string: queryStr,
          new_string: 'replacedQueryStr'
        },
        context
      )

      expect(res.resultForUi.summary).toContain('Replaced 1 occurrence')
      const readContent = await fs.readFile(filePath, 'utf-8')
      expect(readContent).toBe('replacedQueryStr')

      // revert change
      await fs.writeFile(filePath, queryStr)
    })

    it('rejects editing outside workspace if no active run context', async () => {
      const context = { reqId: 'test-req-no-run', signal: new AbortController().signal }
      const outsidePath = resolve(workspaceRoot, '..', 'traversal-edit.txt')

      await fs.writeFile(outsidePath, 'some data')

      try {
        await expect(
          ToolRegistry.file_edit.execute(
            {
              path: outsidePath,
              old_string: 'some',
              new_string: 'other'
            },
            context
          )
        ).rejects.toThrow('outside the global workspace and current project root')
      } finally {
        await fs.unlink(outsidePath).catch(() => {})
      }
    })

    it('permits editing inside the current project root when run context is active', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-with-run'
      createRun(
        reqId,
        [],
        'all',
        new ActionLog(),
        undefined,
        undefined,
        projectRoot,
        'Test Project'
      )

      const context = { reqId, signal: new AbortController().signal }
      const projectFile = join(projectRoot, 'project-edit.txt')

      await fs.writeFile(projectFile, 'original project data')

      try {
        // Read first to satisfy the read-before-edit constraint.
        await ToolRegistry.file_read.execute({ path: 'project-edit.txt' }, context)
        const res = await ToolRegistry.file_edit.execute(
          {
            path: 'project-edit.txt',
            old_string: 'original project data',
            new_string: 'edited project data'
          },
          context
        )

        expect(res.resultForUi.summary).toContain('Replaced 1 occurrence')
        const readContent = await fs.readFile(projectFile, 'utf-8')
        expect(readContent).toBe('edited project data')
      } finally {
        destroyRun(reqId)
        await fs.unlink(projectFile).catch(() => {})
      }
    })
  })

  describe('read-before-edit constraint', () => {
    it('blocks file_edit when the file was not read earlier in the run', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-unseen-edit'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'unseen-edit.txt')
      await fs.writeFile(filePath, 'alpha beta gamma')

      try {
        await expect(
          ToolRegistry.file_edit.execute(
            { path: filePath, old_string: 'beta', new_string: 'BETA' },
            context
          )
        ).rejects.toThrow('must read this file before editing')
        // Unchanged on disk
        expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha beta gamma')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('allows file_edit after the file was read in the same run', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-seen-edit'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'seen-edit.txt')
      await fs.writeFile(filePath, 'alpha beta gamma')

      try {
        await ToolRegistry.file_read.execute({ path: filePath }, context)
        const res = await ToolRegistry.file_edit.execute(
          { path: filePath, old_string: 'beta', new_string: 'BETA' },
          context
        )
        expect(res.resultForUi.summary).toContain('Replaced 1 occurrence')
        expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha BETA gamma')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('skips the constraint when there is no active run context', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const filePath = join(testDir, 'no-run-edit.txt')
      await fs.writeFile(filePath, 'alpha beta gamma')

      try {
        const res = await ToolRegistry.file_edit.execute(
          { path: filePath, old_string: 'beta', new_string: 'BETA' },
          context
        )
        expect(res.resultForUi.summary).toContain('Replaced 1 occurrence')
      } finally {
        await fs.unlink(filePath).catch(() => {})
      }
    })
  })

  describe('multi_edit tool', () => {
    it('applies multiple sequential edits atomically', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-multi-edit'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'multi-edit.txt')
      await fs.writeFile(filePath, 'one two three four')

      try {
        await ToolRegistry.file_read.execute({ path: filePath }, context)
        const res = await ToolRegistry.multi_edit.execute(
          {
            path: filePath,
            edits: [
              { old_string: 'one', new_string: '1' },
              { old_string: 'three', new_string: '3' }
            ]
          },
          context
        )
        expect(res.resultForUi.summary).toContain('Applied 2 edit(s)')
        expect(await fs.readFile(filePath, 'utf-8')).toBe('1 two 3 four')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('lets a later edit operate on the result of an earlier edit', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-multi-chain'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'multi-chain.txt')
      await fs.writeFile(filePath, 'foo')

      try {
        await ToolRegistry.file_read.execute({ path: filePath }, context)
        const res = await ToolRegistry.multi_edit.execute(
          {
            path: filePath,
            edits: [
              { old_string: 'foo', new_string: 'bar' },
              { old_string: 'bar', new_string: 'baz' }
            ]
          },
          context
        )
        expect(res.resultForModel).toContain('2 total replacement')
        expect(await fs.readFile(filePath, 'utf-8')).toBe('baz')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('writes nothing when any edit in the batch fails', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-multi-atomic'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'multi-atomic.txt')
      await fs.writeFile(filePath, 'alpha beta gamma')

      try {
        await ToolRegistry.file_read.execute({ path: filePath }, context)
        await expect(
          ToolRegistry.multi_edit.execute(
            {
              path: filePath,
              edits: [
                { old_string: 'alpha', new_string: 'ALPHA' },
                { old_string: 'NOT_PRESENT', new_string: 'x' }
              ]
            },
            context
          )
        ).rejects.toThrow('old_string not found')
        // First edit must NOT have been persisted
        expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha beta gamma')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('rejects ambiguous old_string unless replace_all is set', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-multi-ambiguous'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'multi-ambiguous.txt')
      await fs.writeFile(filePath, 'x x x')

      try {
        await ToolRegistry.file_read.execute({ path: filePath }, context)
        await expect(
          ToolRegistry.multi_edit.execute(
            { path: filePath, edits: [{ old_string: 'x', new_string: 'y' }] },
            context
          )
        ).rejects.toThrow('matched 3 locations')

        const res = await ToolRegistry.multi_edit.execute(
          { path: filePath, edits: [{ old_string: 'x', new_string: 'y', replace_all: true }] },
          context
        )
        expect(res.resultForModel).toContain('3 total replacement')
        expect(await fs.readFile(filePath, 'utf-8')).toBe('y y y')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })

    it('enforces read-before-edit', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-multi-unseen'
      createRun(reqId, [], 'all', new ActionLog())
      const context = { reqId, signal: new AbortController().signal }
      const filePath = join(testDir, 'multi-unseen.txt')
      await fs.writeFile(filePath, 'alpha beta')

      try {
        await expect(
          ToolRegistry.multi_edit.execute(
            { path: filePath, edits: [{ old_string: 'alpha', new_string: 'ALPHA' }] },
            context
          )
        ).rejects.toThrow('must read this file before editing')
        expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha beta')
      } finally {
        destroyRun(reqId)
        await fs.unlink(filePath).catch(() => {})
      }
    })
  })

  describe('directory_create, file_copy, file_move, and file_delete tools', () => {
    it('creates nested directories', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const targetPath = join(testDir, 'ops-create', 'nested')

      try {
        const res = await ToolRegistry.directory_create.execute({ path: targetPath }, context)
        const stat = await fs.stat(targetPath)

        expect(stat.isDirectory()).toBe(true)
        expect(res.resultForUi.summary).toContain('Created directory')
      } finally {
        await fs.rm(join(testDir, 'ops-create'), { recursive: true, force: true })
      }
    })

    it('copies files and requires overwrite for an existing destination', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const sourcePath = join(testDir, 'copy-source.txt')
      const destinationPath = join(testDir, 'ops-copy', 'copy-destination.txt')

      try {
        await fs.writeFile(sourcePath, 'copy source')

        const res = await ToolRegistry.file_copy.execute({ sourcePath, destinationPath }, context)
        expect(res.resultForModel).toContain('Copied file')
        expect(await fs.readFile(destinationPath, 'utf-8')).toBe('copy source')

        await expect(
          ToolRegistry.file_copy.execute({ sourcePath, destinationPath }, context)
        ).rejects.toThrow('Destination file already exists')

        await fs.writeFile(sourcePath, 'copy replacement')
        await ToolRegistry.file_copy.execute(
          { sourcePath, destinationPath, overwrite: true },
          context
        )
        expect(await fs.readFile(destinationPath, 'utf-8')).toBe('copy replacement')
      } finally {
        await fs.unlink(sourcePath).catch(() => {})
        await fs.rm(join(testDir, 'ops-copy'), { recursive: true, force: true })
      }
    })

    it('moves files and refuses to move a directory inside itself', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const sourcePath = join(testDir, 'move-source.txt')
      const destinationPath = join(testDir, 'ops-move', 'move-destination.txt')
      const sourceDir = join(testDir, 'move-dir')

      try {
        await fs.writeFile(sourcePath, 'move source')
        const res = await ToolRegistry.file_move.execute({ sourcePath, destinationPath }, context)

        expect(res.resultForModel).toContain('Moved path')
        await expect(fs.stat(sourcePath)).rejects.toThrow()
        expect(await fs.readFile(destinationPath, 'utf-8')).toBe('move source')

        await fs.mkdir(sourceDir, { recursive: true })
        await expect(
          ToolRegistry.file_move.execute(
            { sourcePath: sourceDir, destinationPath: join(sourceDir, 'child') },
            context
          )
        ).rejects.toThrow('Destination cannot be inside the source path')
      } finally {
        await fs.unlink(sourcePath).catch(() => {})
        await fs.rm(join(testDir, 'ops-move'), { recursive: true, force: true })
        await fs.rm(sourceDir, { recursive: true, force: true })
      }
    })

    it('deletes files and requires recursive=true for directories', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const filePath = join(testDir, 'delete-me.txt')
      const dirPath = join(testDir, 'delete-dir')

      try {
        await fs.writeFile(filePath, 'delete me')
        const res = await ToolRegistry.file_delete.execute({ path: filePath }, context)
        expect(res.resultForModel).toContain('Deleted path')
        await expect(fs.stat(filePath)).rejects.toThrow()

        await fs.mkdir(dirPath, { recursive: true })
        await fs.writeFile(join(dirPath, 'nested.txt'), 'nested')
        await expect(ToolRegistry.file_delete.execute({ path: dirPath }, context)).rejects.toThrow(
          'Set recursive=true'
        )

        await ToolRegistry.file_delete.execute({ path: dirPath, recursive: true }, context)
        await expect(fs.stat(dirPath)).rejects.toThrow()
      } finally {
        await fs.unlink(filePath).catch(() => {})
        await fs.rm(dirPath, { recursive: true, force: true })
      }
    })

    it('refuses to delete the workspace root or .git directory', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const gitPath = join(workspaceRoot, '.git')
      const sourcePath = join(testDir, 'git-target-source.txt')
      let createdGitPath = false

      try {
        await expect(
          ToolRegistry.file_delete.execute({ path: workspaceRoot, recursive: true }, context)
        ).rejects.toThrow('selected root')

        try {
          await fs.stat(gitPath)
        } catch {
          await fs.mkdir(gitPath, { recursive: true })
          createdGitPath = true
        }

        await expect(
          ToolRegistry.file_delete.execute({ path: gitPath, recursive: true }, context)
        ).rejects.toThrow('.git directory')

        await fs.writeFile(sourcePath, 'source')
        await expect(
          ToolRegistry.directory_create.execute({ path: join(gitPath, 'new-dir') }, context)
        ).rejects.toThrow('.git directory')
        await expect(
          ToolRegistry.file_copy.execute(
            { sourcePath, destinationPath: join(gitPath, 'copy.txt') },
            context
          )
        ).rejects.toThrow('.git directory')
        await expect(
          ToolRegistry.file_move.execute(
            { sourcePath, destinationPath: join(gitPath, 'move.txt') },
            context
          )
        ).rejects.toThrow('.git directory')
      } finally {
        await fs.unlink(sourcePath).catch(() => {})
        if (createdGitPath) {
          await fs.rm(gitPath, { recursive: true, force: true })
        }
      }
    })
  })

  describe('file_diff tool', () => {
    it('compares identical files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.file_diff.execute(
        {
          path_a: join(testDir, 'root.ts'),
          path_b: join(testDir, 'root.ts')
        },
        context
      )
      expect(res.resultForModel).toContain('Files are identical.')
      expect(res.resultForUi.summary).toBe('Files are identical')
    })

    it('compares different files and returns a unified diff', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const pathA = join(testDir, 'a.txt')
      const pathB = join(testDir, 'b.log')

      const res = await ToolRegistry.file_diff.execute(
        {
          path_a: pathA,
          path_b: pathB
        },
        context
      )

      expect(res.resultForModel).toContain('@@ -1,4 +1,3 @@')
      expect(res.resultForModel).toContain('- line1')
      expect(res.resultForModel).toContain('+ UNIQUEMATCH')
      expect(res.resultForModel).toContain('- line4')
      expect(res.resultForUi.summary).toContain('Generated file differences diff')
    })

    it('rejects comparing outside workspace if no active run context', async () => {
      const context = { reqId: 'test-req-no-run', signal: new AbortController().signal }
      const outsidePath = resolve(workspaceRoot, '..', 'traversal-diff.txt')
      await fs.writeFile(outsidePath, 'some data')

      try {
        await expect(
          ToolRegistry.file_diff.execute(
            {
              path_a: join(testDir, 'root.ts'),
              path_b: outsidePath
            },
            context
          )
        ).rejects.toThrow('outside the global workspace and current project root')
      } finally {
        await fs.unlink(outsidePath).catch(() => {})
      }
    })

    it('permits comparing files inside the current project root when run context is active', async () => {
      const { createRun, destroyRun } = await import('./agent/AgentRunContext')
      const { ActionLog } = await import('./agent/actionLog')

      const reqId = 'test-req-diff-run'
      createRun(
        reqId,
        [],
        'all',
        new ActionLog(),
        undefined,
        undefined,
        projectRoot,
        'Test Project'
      )

      const context = { reqId, signal: new AbortController().signal }

      try {
        const res = await ToolRegistry.file_diff.execute(
          {
            path_a: 'project-diff.txt',
            path_b: join(projectRoot, 'project-diff.txt')
          },
          context
        )

        expect(res.resultForModel).toContain('Files are identical.')
      } finally {
        destroyRun(reqId)
      }
    })
  })

  describe('searchToolDefinitions', () => {
    it('finds file read and write tools using Chinese queries', () => {
      const results = searchToolDefinitions('文件读取 md 翻译')
      const names = results.map((r) => r.name)
      expect(names).toContain('file_read')
      expect(names).toContain('file_write')
    })

    it('finds file read and listing tools using multi-word English query', () => {
      const results = searchToolDefinitions('list directory read files')
      const names = results.map((r) => r.name)
      expect(names).toContain('file_read')
      expect(names).toContain('workspace_list_files')
    })

    it('finds workspace_list_files using translation queries', () => {
      const results = searchToolDefinitions('translate markdown files')
      const names = results.map((r) => r.name)
      expect(names).toContain('workspace_list_files')
    })

    it('finds workspace_add_root using reference project queries', () => {
      const results = searchToolDefinitions('add reference project root directory')
      const names = results.map((r) => r.name)
      expect(names).toContain('workspace_add_root')
    })
  })
})
