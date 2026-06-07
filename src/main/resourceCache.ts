import { app } from 'electron'
import * as crypto from 'crypto'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { SessionResource, SessionResourceChunk, ResourceKind } from '../shared/types'

// Cache file structure on disk
export interface CachedResourceFile {
  id: string
  kind: ResourceKind
  source: string
  title?: string
  fingerprint?: string
  totalChars?: number
  fetchedRanges?: Array<{ start: number; end: number }>
  nextOffset?: number
  status: 'partial' | 'complete' | 'stale'
  summary?: string
  chunks: SessionResourceChunk[] // These chunks contain full raw text
  createdAt: number
  updatedAt: number
}

export function getResourceId(source: string): string {
  return crypto.createHash('md5').update(source).digest('hex')
}

export function getResourcesDir(): string {
  return join(app.getPath('userData'), 'resources')
}

export const RESOURCE_ID_PATTERN = /^[a-f0-9]{32}$/

export function getResourceFilePath(resourceId: string): string {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  return join(getResourcesDir(), `${resourceId}.json`)
}

export function mergeRanges(
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end)
    } else {
      merged.push(curr)
    }
  }
  return merged
}

export function getFirstMissingOffset(
  ranges: Array<{ start: number; end: number }>,
  totalChars: number | undefined
): number | undefined {
  if (totalChars === undefined || totalChars <= 0) return undefined

  const merged = mergeRanges(
    ranges
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
      .map((range) => ({
        start: Math.max(0, range.start),
        end: Math.max(0, range.end)
      }))
      .filter((range) => range.end > range.start)
  )

  let cursor = 0
  for (const range of merged) {
    if (range.end <= cursor) continue
    if (range.start > cursor) return cursor
    cursor = Math.max(cursor, range.end)
    if (cursor >= totalChars) return undefined
  }

  return cursor < totalChars ? cursor : undefined
}

function getCoverageState(
  ranges: Array<{ start: number; end: number }>,
  totalChars: number | undefined
): { status: 'partial' | 'complete'; nextOffset?: number } {
  if (totalChars === undefined) {
    return { status: 'partial' }
  }

  const firstMissingOffset = getFirstMissingOffset(ranges, totalChars)
  if (firstMissingOffset === undefined) {
    return { status: 'complete' }
  }

  return { status: 'partial', nextOffset: firstMissingOffset }
}

export async function saveResourceChunk(
  resourceId: string,
  kind: ResourceKind,
  source: string,
  title: string | undefined,
  totalChars: number | undefined,
  nextOffset: number | undefined,
  newChunk: SessionResourceChunk
): Promise<SessionResource> {
  const dir = getResourcesDir()
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }

  const filePath = getResourceFilePath(resourceId)
  let resourceData: CachedResourceFile

  if (existsSync(filePath)) {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8')
      resourceData = JSON.parse(fileContent) as CachedResourceFile
    } catch (err) {
      console.error(`Failed to read/parse resource cache file ${filePath}:`, err)
      // Initialize if corrupted
      resourceData = {
        id: resourceId,
        kind,
        source,
        chunks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'partial'
      }
    }
  } else {
    resourceData = {
      id: resourceId,
      kind,
      source,
      chunks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'partial'
    }
  }

  // Update resource-level fields
  if (title) resourceData.title = title
  if (totalChars !== undefined) resourceData.totalChars = totalChars
  resourceData.updatedAt = Date.now()

  // Upsert the chunk
  const existingChunkIdx = resourceData.chunks.findIndex((c) => c.id === newChunk.id)
  if (existingChunkIdx !== -1) {
    resourceData.chunks[existingChunkIdx] = newChunk
  } else {
    resourceData.chunks.push(newChunk)
  }

  // Prune chunks if total text size exceeds 2MB limit (approx 2,000,000 chars)
  const MAX_TEXT_CHARS = 2 * 1024 * 1024
  const currentTotalChars = resourceData.chunks.reduce((sum, c) => sum + (c.text?.length || 0), 0)

  if (currentTotalChars > MAX_TEXT_CHARS) {
    // Sort chunks by age (createdAt) ascending to remove oldest first,
    // but keep the newly added chunk at all costs
    const sortedChunks = [...resourceData.chunks].sort((a, b) => a.createdAt - b.createdAt)
    const prunedChunks: SessionResourceChunk[] = []

    // We start from the newest to keep them
    const reversedSorted = [...sortedChunks].reverse()
    let keptChars = 0
    for (const chunk of reversedSorted) {
      const chunkLen = chunk.text?.length || 0
      if (chunk.id === newChunk.id || keptChars + chunkLen <= MAX_TEXT_CHARS) {
        prunedChunks.unshift(chunk)
        keptChars += chunkLen
      }
    }
    resourceData.chunks = prunedChunks
  }

  // Recalculate fetched ranges based on current chunks
  const newRanges: Array<{ start: number; end: number }> = []
  resourceData.chunks.forEach((c) => {
    if (c.offset !== undefined && c.endOffset !== undefined) {
      newRanges.push({ start: c.offset, end: c.endOffset })
    }
  })
  resourceData.fetchedRanges = mergeRanges(newRanges)
  const coverageState = getCoverageState(resourceData.fetchedRanges, resourceData.totalChars)
  resourceData.status = coverageState.status
  resourceData.nextOffset = coverageState.status === 'complete' ? undefined : coverageState.nextOffset ?? nextOffset

  // Write to disk (with full chunk texts)
  await fs.writeFile(filePath, JSON.stringify(resourceData, null, 2), 'utf-8')

  // Return SessionResource metadata-only for IPC transfer
  // Stripping full text to prevent bloating Session storage
  const returnChunks: SessionResourceChunk[] = resourceData.chunks.map((c) => ({
    id: c.id,
    offset: c.offset,
    endOffset: c.endOffset,
    page: c.page,
    section: c.section,
    summary: c.summary,
    createdAt: c.createdAt
    // text is omitted (undefined)
  }))

  return {
    id: resourceData.id,
    kind: resourceData.kind,
    source: resourceData.source,
    title: resourceData.title,
    fingerprint: resourceData.fingerprint,
    totalChars: resourceData.totalChars,
    fetchedRanges: resourceData.fetchedRanges,
    nextOffset: resourceData.nextOffset,
    status: resourceData.status,
    summary: resourceData.summary,
    chunks: returnChunks,
    createdAt: resourceData.createdAt,
    updatedAt: resourceData.updatedAt
  }
}

export async function readResourceChunk(resourceId: string, offset: number): Promise<string> {
  const filePath = getResourceFilePath(resourceId)
  if (!existsSync(filePath)) {
    throw new Error(`Resource cache file not found for ID: ${resourceId}`)
  }

  const fileContent = await fs.readFile(filePath, 'utf-8')
  const resourceData = JSON.parse(fileContent) as CachedResourceFile

  // Find exact offset match first
  let matchedChunk = resourceData.chunks.find((c) => c.offset === offset)

  // Fallback to range overlap match
  if (!matchedChunk) {
    matchedChunk = resourceData.chunks.find(
      (c) => c.offset !== undefined && c.endOffset !== undefined && c.offset <= offset && c.endOffset > offset
    )
  }

  if (!matchedChunk || !matchedChunk.text) {
    throw new Error(`Resource chunk at offset ${offset} is not cached in resource ID: ${resourceId}`)
  }

  return matchedChunk.text
}
