import * as crypto from 'crypto'
import {
  getDb,
  loadResourceCache,
  upsertResourceCache,
  upsertResourceChunk,
  deleteResourceFromDb,
  getResourceChunkText,
  pruneResourceChunks,
  getResourceChunksMetadata
} from './database'
import { SessionResource, SessionResourceChunk, ResourceKind } from '../shared/types'

// Cache file structure on disk — kept for type compatibility
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
  chunks: SessionResourceChunk[]
  createdAt: number
  updatedAt: number
}

export function getResourceId(source: string): string {
  return crypto.createHash('md5').update(source).digest('hex')
}

export function getResourcesDir(): string {
  // Return the database directory for backward compatibility
  return getDb().name.replace(/\.db$/, '')
}

export const RESOURCE_ID_PATTERN = /^[a-f0-9]{32}$/

export function getResourceFilePath(resourceId: string): string {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  // Return a virtual path for backward compatibility — used by search_cached_resource
  return getDb().name
}

export async function deleteResourceFile(resourceId: string): Promise<void> {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    console.warn(`Skipping delete of resource with malformed id: ${resourceId}`)
    return
  }
  try {
    deleteResourceFromDb(resourceId)
  } catch (err) {
    console.warn(`Failed to delete resource from db ${resourceId}:`, (err as Error).message)
  }
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
  ranges: Array<{ start: number; end: number }> | undefined,
  totalChars: number | undefined
): number | undefined {
  if (!ranges || totalChars === undefined || totalChars <= 0) return undefined

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
  const now = Date.now()
  const existing = loadResourceCache(resourceId)

  // Ensure parent resource_cache row exists BEFORE inserting chunks (FK constraint)
  if (!existing) {
    upsertResourceCache(
      resourceId,
      kind,
      source,
      title,
      totalChars,
      '[]',
      nextOffset,
      'partial',
      undefined,
      now
    )
  }

  // Upsert the chunk
  upsertResourceChunk(resourceId, newChunk)

  // Prune chunks if total text exceeds 2MB
  const MAX_TEXT_CHARS = 2 * 1024 * 1024
  pruneResourceChunks(resourceId, MAX_TEXT_CHARS)

  // Get updated chunk metadata for range calculation
  const chunkMeta = getResourceChunksMetadata(resourceId)
  const newRanges: Array<{ start: number; end: number }> = []
  chunkMeta.forEach((c) => {
    if (c.offset !== null && c.offset !== undefined && c.endOffset !== null && c.endOffset !== undefined) {
      newRanges.push({ start: c.offset, end: c.endOffset })
    }
  })
  const fetchedRanges = mergeRanges(newRanges)
  const coverageState = getCoverageState(fetchedRanges, totalChars)
  const status = coverageState.status
  const effectiveNextOffset =
    coverageState.status === 'complete' ? undefined : coverageState.nextOffset ?? nextOffset

  // Update the resource cache entry with final state
  upsertResourceCache(
    resourceId,
    kind,
    source,
    title || existing?.title || undefined,
    totalChars ?? existing?.totalChars ?? undefined,
    JSON.stringify(fetchedRanges),
    effectiveNextOffset,
    status,
    existing?.summary || undefined,
    now
  )

  // Return metadata-only SessionResource (strip text from chunks)
  const allChunks = getResourceChunksMetadata(resourceId)
  const returnChunks: SessionResourceChunk[] = allChunks.map((c) => ({
    id: c.id,
    offset: c.offset ?? undefined,
    endOffset: c.endOffset ?? undefined,
    createdAt: c.createdAt,
    summary: undefined
    // text is omitted
  }))

  const updated = loadResourceCache(resourceId)!

  return {
    id: updated.id,
    kind: updated.kind as ResourceKind,
    source: updated.source,
    title: updated.title || undefined,
    fingerprint: updated.fingerprint || undefined,
    totalChars: updated.totalChars ?? undefined,
    fetchedRanges: JSON.parse(updated.fetchedRanges || '[]'),
    nextOffset: updated.nextOffset ?? undefined,
    status: updated.status as SessionResource['status'],
    summary: updated.summary || undefined,
    chunks: returnChunks,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  }
}

export async function readResourceChunk(resourceId: string, offset: number): Promise<string> {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  const text = getResourceChunkText(resourceId, offset)
  if (text === null) {
    throw new Error(
      `Resource chunk at offset ${offset} is not cached in resource ID: ${resourceId}`
    )
  }
  return text
}
