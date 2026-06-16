import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import {
  getResourceId,
  saveResourceChunk,
  readResourceChunk,
  readResourceChunkWindow,
  mergeRanges,
  getFirstMissingOffset
} from './resourceCache'
import { closeDb } from './database'
import { SessionResourceChunk } from '../shared/types'
import { describeWithSqlite } from './testSupport/nativeSqlite'

const testDir = join(__dirname, '../../temp-resource-cache-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describeWithSqlite('resourceCache', () => {
  beforeEach(async () => {
    // Clean up test directory and close any leftover db connection
    closeDb()
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  describe('getResourceId', () => {
    it('generates a deterministic MD5 hash for a source', () => {
      const url = 'https://arxiv.org/abs/2601.10710'
      const id1 = getResourceId(url)
      const id2 = getResourceId(url)
      expect(id1).toBe(id2)
      expect(id1).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('mergeRanges', () => {
    it('returns empty array for empty input', () => {
      expect(mergeRanges([])).toEqual([])
    })

    it('returns same array if only one range', () => {
      expect(mergeRanges([{ start: 0, end: 100 }])).toEqual([{ start: 0, end: 100 }])
    })

    it('merges overlapping and adjacent ranges', () => {
      const input = [
        { start: 0, end: 1000 },
        { start: 1000, end: 2000 },
        { start: 500, end: 1500 },
        { start: 3000, end: 4000 }
      ]
      const merged = mergeRanges(input)
      expect(merged).toEqual([
        { start: 0, end: 2000 },
        { start: 3000, end: 4000 }
      ])
    })
  })

  describe('getFirstMissingOffset', () => {
    it('returns the first uncovered offset for sparse ranges', () => {
      const ranges = [
        { start: 0, end: 10000 },
        { start: 30000, end: 74261 }
      ]

      expect(getFirstMissingOffset(ranges, 74261)).toBe(10000)
    })

    it('returns undefined when ranges cover the full resource', () => {
      expect(getFirstMissingOffset([{ start: 0, end: 200 }], 200)).toBeUndefined()
    })
  })

  describe('saveResourceChunk and readResourceChunk', () => {
    it('saves chunks to database and retrieves them', async () => {
      const source = 'https://example.com/test'
      const resourceId = getResourceId(source)

      const chunk1: SessionResourceChunk = {
        id: 'chunk-0-100',
        offset: 0,
        endOffset: 100,
        text: 'Hello, this is the first chunk of text cached for testing resource store.',
        summary: 'First chunk summary',
        createdAt: Date.now()
      }

      const resMetadata = await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Test Resource Title',
        1000,
        100,
        chunk1
      )

      expect(resMetadata.id).toBe(resourceId)
      expect(resMetadata.title).toBe('Test Resource Title')
      expect(resMetadata.status).toBe('partial')
      expect(resMetadata.nextOffset).toBe(100)
      expect(resMetadata.fetchedRanges).toEqual([{ start: 0, end: 100 }])
      // Chunks in returned metadata should NOT contain the full raw text
      expect(resMetadata.chunks[0].text).toBeUndefined()
      expect(resMetadata.chunks[0].summary).toBeUndefined() // summary stripped from metadata return

      // Retrieve full text from cache
      const retrievedText = await readResourceChunk(resourceId, 0)
      expect(retrievedText).toBe(chunk1.text)
    })

    it('rejects invalid resource IDs before reading', async () => {
      await expect(readResourceChunk('../quickai_store', 0)).rejects.toThrow('Invalid resource ID')
    })

    it('merges multiple chunks and handles status updates', async () => {
      const source = 'https://example.com/multi'
      const resourceId = getResourceId(source)

      const chunk1: SessionResourceChunk = {
        id: 'chunk-0-100',
        offset: 0,
        endOffset: 100,
        text: 'Chunk 1 content...',
        summary: 'Chunk 1',
        createdAt: Date.now()
      }

      const chunk2: SessionResourceChunk = {
        id: 'chunk-100-200',
        offset: 100,
        endOffset: 200,
        text: 'Chunk 2 content...',
        summary: 'Chunk 2',
        createdAt: Date.now() + 10
      }

      await saveResourceChunk(resourceId, 'web', source, 'Multi Chunk', 200, 100, chunk1)
      const resMetadata2 = await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Multi Chunk',
        200,
        undefined,
        chunk2
      )

      expect(resMetadata2.status).toBe('complete')
      expect(resMetadata2.nextOffset).toBeUndefined()
      expect(resMetadata2.fetchedRanges).toEqual([{ start: 0, end: 200 }])
      expect(resMetadata2.chunks).toHaveLength(2)

      const text1 = await readResourceChunk(resourceId, 0)
      const text2 = await readResourceChunk(resourceId, 100)
      expect(text1).toBe('Chunk 1 content...')
      expect(text2).toBe('Chunk 2 content...')
    })

    it('does not mark a resource complete when the middle range is missing', async () => {
      const source = 'https://example.com/missing-middle'
      const resourceId = getResourceId(source)

      const chunk1: SessionResourceChunk = {
        id: 'chunk-0-100',
        offset: 0,
        endOffset: 100,
        text: 'a'.repeat(100),
        createdAt: Date.now()
      }

      const chunk3: SessionResourceChunk = {
        id: 'chunk-200-300',
        offset: 200,
        endOffset: 300,
        text: 'c'.repeat(100),
        createdAt: Date.now() + 10
      }

      await saveResourceChunk(resourceId, 'web', source, 'Missing Middle', 300, 100, chunk1)
      const sparseMetadata = await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Missing Middle',
        300,
        undefined,
        chunk3
      )

      expect(sparseMetadata.status).toBe('partial')
      expect(sparseMetadata.nextOffset).toBe(100)
      expect(sparseMetadata.fetchedRanges).toEqual([
        { start: 0, end: 100 },
        { start: 200, end: 300 }
      ])

      const chunk2: SessionResourceChunk = {
        id: 'chunk-100-200',
        offset: 100,
        endOffset: 200,
        text: 'b'.repeat(100),
        createdAt: Date.now() + 20
      }

      const completeMetadata = await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Missing Middle',
        300,
        undefined,
        chunk2
      )

      expect(completeMetadata.status).toBe('complete')
      expect(completeMetadata.nextOffset).toBeUndefined()
      expect(completeMetadata.fetchedRanges).toEqual([{ start: 0, end: 300 }])
    })

    it('limits text capacity to 2MB and prunes oldest chunks', async () => {
      const source = 'https://example.com/oversized'
      const resourceId = getResourceId(source)

      // We will save 3 chunks. Each chunk is 1MB.
      // Total size is 3MB, which exceeds the 2MB limit.
      // The first chunk (oldest) should be pruned, while chunk 2 and chunk 3 should remain.
      const largeText1 = 'a'.repeat(1024 * 1024) // 1MB
      const largeText2 = 'b'.repeat(1024 * 1024) // 1MB
      const largeText3 = 'c'.repeat(1024 * 1024) // 1MB

      const chunk1: SessionResourceChunk = {
        id: 'chunk-1',
        offset: 0,
        endOffset: 100,
        text: largeText1,
        createdAt: 1000 // Very old
      }

      const chunk2: SessionResourceChunk = {
        id: 'chunk-2',
        offset: 100,
        endOffset: 200,
        text: largeText2,
        createdAt: 2000
      }

      const chunk3: SessionResourceChunk = {
        id: 'chunk-3',
        offset: 200,
        endOffset: 300,
        text: largeText3,
        createdAt: 3000 // Newest (current chunk)
      }

      await saveResourceChunk(resourceId, 'web', source, 'Prune Test', 1000, 100, chunk1)
      await saveResourceChunk(resourceId, 'web', source, 'Prune Test', 1000, 200, chunk2)
      const resMetadata = await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Prune Test',
        1000,
        undefined,
        chunk3
      )

      // Only chunk-2 and chunk-3 should remain, chunk-1 is pruned
      expect(resMetadata.chunks).toHaveLength(2)
      expect(resMetadata.chunks.map((c) => c.id)).toEqual(['chunk-2', 'chunk-3'])
      expect(resMetadata.fetchedRanges).toEqual([{ start: 100, end: 300 }])

      // Attempting to read chunk-1 should throw
      await expect(readResourceChunk(resourceId, 0)).rejects.toThrow()

      // Reading chunk-2 and chunk-3 should succeed
      expect(await readResourceChunk(resourceId, 100)).toBe(largeText2)
      expect(await readResourceChunk(resourceId, 200)).toBe(largeText3)
    })

    it('downgrades out-of-range cached reads to the nearest readable chunk', async () => {
      const source = 'https://example.com/out-of-range'
      const resourceId = getResourceId(source)

      const chunk1: SessionResourceChunk = {
        id: 'chunk-100-150',
        offset: 100,
        endOffset: 150,
        text: 'first cached chunk',
        createdAt: Date.now()
      }
      const chunk2: SessionResourceChunk = {
        id: 'chunk-300-350',
        offset: 300,
        endOffset: 350,
        text: 'last cached chunk',
        createdAt: Date.now() + 10
      }

      await saveResourceChunk(resourceId, 'web', source, 'Out Of Range', 400, 150, chunk1)
      await saveResourceChunk(resourceId, 'web', source, 'Out Of Range', 400, undefined, chunk2)

      const beforeFirst = await readResourceChunkWindow(resourceId, -50)
      expect(beforeFirst.offset).toBe(100)
      expect(beforeFirst.endOffset).toBe(150)
      expect(beforeFirst.text).toBe('first cached chunk')
      expect(beforeFirst.warning).toContain('before the first cached chunk')

      const gap = await readResourceChunkWindow(resourceId, 200)
      expect(gap.offset).toBe(300)
      expect(gap.endOffset).toBe(350)
      expect(gap.text).toBe('last cached chunk')
      expect(gap.warning).toContain('is not cached')

      const beyondEnd = await readResourceChunkWindow(resourceId, 999)
      expect(beyondEnd.offset).toBe(300)
      expect(beyondEnd.endOffset).toBe(350)
      expect(beyondEnd.text).toBe('last cached chunk')
      expect(beyondEnd.warning).toContain('beyond cached content')
    })
  })

  describe('search_cached_resource tool execution', () => {
    it('searches successfully and returns matched offsets and snippets', async () => {
      const source = 'https://example.com/search-test'
      const resourceId = getResourceId(source)

      const chunk1: SessionResourceChunk = {
        id: 'chunk-0-100',
        offset: 0,
        endOffset: 100,
        text: 'This is a test document containing experimental settings for AI model training.',
        summary: 'Chunk 1',
        createdAt: Date.now()
      }

      const chunk2: SessionResourceChunk = {
        id: 'chunk-100-200',
        offset: 100,
        endOffset: 200,
        text: 'The learning rate is set to 0.001 and weight decay is 0.01.',
        summary: 'Chunk 2',
        createdAt: Date.now() + 10
      }

      await saveResourceChunk(resourceId, 'web', source, 'Search Test Title', 200, 100, chunk1)
      await saveResourceChunk(
        resourceId,
        'web',
        source,
        'Search Test Title',
        200,
        undefined,
        chunk2
      )

      // Execute tool Registry search_cached_resource
      const { ToolRegistry } = await import('./toolRegistry')

      // Exact query match
      const res1 = await ToolRegistry.search_cached_resource.execute(
        { resourceId, query: 'learning rate' },
        { reqId: 'test-req', signal: new AbortController().signal }
      )
      expect(res1.resultForModel).toContain('Chunk Offset: 100-200')
      expect(res1.resultForModel).toContain('learning rate')

      // Keyword fallback match (when exact query doesn't match, e.g. "experimental learning")
      const res2 = await ToolRegistry.search_cached_resource.execute(
        { resourceId, query: 'experimental learning' },
        { reqId: 'test-req', signal: new AbortController().signal }
      )
      expect(res2.resultForModel).toContain('Chunk Offset: 0-100')
      expect(res2.resultForModel).toContain('Chunk Offset: 100-200')
    })

    it('read_cached_resource reports offset adjustment instead of failing', async () => {
      const source = 'https://example.com/tool-read-adjust'
      const resourceId = getResourceId(source)
      const chunk: SessionResourceChunk = {
        id: 'chunk-0-20',
        offset: 0,
        endOffset: 20,
        text: 'cached tool content',
        createdAt: Date.now()
      }

      await saveResourceChunk(resourceId, 'web', source, 'Tool Read Adjust', 20, undefined, chunk)

      const { ToolRegistry } = await import('./toolRegistry')
      const result = await ToolRegistry.read_cached_resource.execute(
        { resourceId, offset: 999 },
        { reqId: 'test-req', signal: new AbortController().signal }
      )

      expect(result.resultForModel).toContain('Requested Offset: 999')
      expect(result.resultForModel).toContain('Returned Offset: 0-20')
      expect(result.resultForModel).toContain('Warning:')
      expect(result.resultForModel).toContain('cached tool content')
      expect(result.resultForUi.summary).toContain('Adjusted offset 999 to 0-20')
    })
  })
})
