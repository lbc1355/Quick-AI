import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { isPathInWorkspace, isSensitiveFile, ToolRegistry, getWorkspaceRoot, searchToolDefinitions } from './toolRegistry'

describe('File Safety & Search Tools', () => {
  const workspaceRoot = getWorkspaceRoot()
  const testDir = join(workspaceRoot, 'temp-file-test-dir')

  // Use concatenated strings so the test file itself does not contain the literal search terms
  const queryStr = 'uniqueMatch' + 'QueryStringForTestingFileTools'
  const queryStrUpper = queryStr.toUpperCase()

  beforeAll(async () => {
    // Set up a temporary folder structure within the workspace for testing
    await fs.mkdir(testDir, { recursive: true })
    await fs.mkdir(join(testDir, 'sub'), { recursive: true })
    await fs.mkdir(join(testDir, 'sub', 'deep'), { recursive: true })
    await fs.mkdir(join(testDir, 'node_modules'), { recursive: true })

    await fs.writeFile(join(testDir, 'a.txt'), `line1\nline2\n${queryStr}\nline4`)
    await fs.writeFile(join(testDir, 'b.log'), `${queryStr}\nline2\n${queryStrUpper}`)
    await fs.writeFile(join(testDir, 'root.ts'), `${queryStr}`)
    await fs.writeFile(join(testDir, 'sub', 'c.ts'), `other\n${queryStr}`)
    await fs.writeFile(join(testDir, 'sub', 'deep', 'd.ts'), `${queryStr}`)
    await fs.writeFile(join(testDir, 'sub', 'sensitive.key'), 'secret')
    await fs.writeFile(join(testDir, '.env'), 'SECRET_KEY=123')
    await fs.writeFile(join(testDir, 'node_modules', 'ignored.txt'), queryStr)
  })

  afterAll(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true })
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
    })

    it('rejects reading outside workspace', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const outsidePath = resolve(workspaceRoot, '..', 'traversal.txt')

      await expect(ToolRegistry.file_read.execute({ path: outsidePath }, context)).rejects.toThrow(
        'Path is outside the workspace directory'
      )
    })

    it('rejects reading sensitive files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }

      await expect(
        ToolRegistry.file_read.execute({ path: join(testDir, '.env') }, context)
      ).rejects.toThrow('Reading sensitive file is blocked')
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
        ).rejects.toThrow('Security Violation: Path is outside the workspace directory')
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
        expect(res.resultForModel).toContain('[Warning: Search scan was truncated. Reason: Time limit exceeded]')
        expect(res.resultForUi.summary).toContain('Scan truncated: Time limit exceeded')
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('logs and displays workspace root in file_read and workspace_search', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const resSearch = await ToolRegistry.workspace_search.execute({ query: queryStr }, context)
      expect(resSearch.resultForModel).toContain(`Workspace Root: ${workspaceRoot}`)
      expect(resSearch.resultForUi.summary).toContain(workspaceRoot)

      const resRead = await ToolRegistry.file_read.execute({ path: join(testDir, 'a.txt') }, context)
      expect(resRead.resultForModel).toContain(`Workspace Root: ${workspaceRoot}`)
      expect(resRead.resultForUi.summary).toContain(workspaceRoot)
    })
  })

  describe('workspace_list_files tool', () => {
    it('lists matching files inside workspace', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_list_files.execute({ glob: 'temp-file-test-dir/**/*.txt' }, context)
      expect(res.resultForUi.items).toHaveLength(1)
      expect(res.resultForUi.items![0].title).toBe('temp-file-test-dir/a.txt')
      expect(res.resultForModel).toContain('File: temp-file-test-dir/a.txt')
    })

    it('rejects listing symbolic links or sensitive files', async () => {
      const context = { reqId: 'test-req', signal: new AbortController().signal }
      const res = await ToolRegistry.workspace_list_files.execute({ glob: 'temp-file-test-dir/**' }, context)
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
        const res = await ToolRegistry.file_write.execute({
          path: targetPath,
          content: 'hello world from test',
          mode: 'create',
          createDirs: true
        }, context)

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
        await expect(ToolRegistry.file_write.execute({
          path: targetPath,
          content: 'new content',
          mode: 'create'
        }, context)).rejects.toThrow('already exists')

        // mode overwrite should succeed
        const res = await ToolRegistry.file_write.execute({
          path: targetPath,
          content: 'new content',
          mode: 'overwrite'
        }, context)

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
      await expect(ToolRegistry.file_write.execute({
        path: outsidePath,
        content: 'fails'
      }, context)).rejects.toThrow('outside the workspace directory')

      const sensitivePath = join(testDir, '.env')
      await expect(ToolRegistry.file_write.execute({
        path: sensitivePath,
        content: 'fails',
        mode: 'overwrite'
      }, context)).rejects.toThrow('sensitive file is blocked')
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
  })
})
