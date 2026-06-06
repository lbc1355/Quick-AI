import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { isPathInWorkspace, isSensitiveFile, ToolRegistry, getWorkspaceRoot } from './toolRegistry'

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
    await fs.mkdir(join(testDir, 'node_modules'), { recursive: true })

    await fs.writeFile(join(testDir, 'a.txt'), `line1\nline2\n${queryStr}\nline4`)
    await fs.writeFile(join(testDir, 'b.log'), `${queryStr}\nline2\n${queryStrUpper}`)
    await fs.writeFile(join(testDir, 'sub', 'c.ts'), `other\n${queryStr}`)
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

      // matches: 1 in a.txt, 2 in b.log, 1 in c.ts (ignored.txt in node_modules is skipped)
      expect(res.resultForUi.items).toHaveLength(4)
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

      // Case insensitive (default) - should match 4 lines across a.txt, b.log, c.ts
      const resInsensitive = await ToolRegistry.workspace_search.execute(
        { query: queryStrUpper },
        context
      )
      expect(resInsensitive.resultForUi.items).toHaveLength(4)

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
  })
})
