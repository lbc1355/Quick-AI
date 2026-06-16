import * as crypto from 'crypto'
import {
  getDb,
  loadResourceCache,
  upsertResourceCache,
  upsertResourceChunk,
  deleteResourceFromDb,
  getResourceChunkText,
  pruneResourceChunks,
  getResourceChunksMetadata,
  saveResourceLinks,
  getResourceLink,
  getResourceFullText
} from './database'
import { SessionResource, SessionResourceChunk, ResourceKind } from '../shared/types'

export interface CachedLink {
  id: number
  text: string
  href: string
}

export interface FindMatch {
  lineNumber: number
  text: string
}

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

export interface ReadResourceChunkWindow {
  text: string
  offset: number
  endOffset: number
  requestedOffset: number
  warning?: string
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
  newChunk: SessionResourceChunk,
  links?: CachedLink[]
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

  // Persist link table (for click_link) when provided
  if (links && links.length > 0) {
    saveResourceLinks(resourceId, links)
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
    if (
      c.offset !== null &&
      c.offset !== undefined &&
      c.endOffset !== null &&
      c.endOffset !== undefined
    ) {
      newRanges.push({ start: c.offset, end: c.endOffset })
    }
  })
  const fetchedRanges = mergeRanges(newRanges)
  const coverageState = getCoverageState(fetchedRanges, totalChars)
  const status = coverageState.status
  const effectiveNextOffset =
    coverageState.status === 'complete' ? undefined : (coverageState.nextOffset ?? nextOffset)

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

export async function readResourceChunkWindow(
  resourceId: string,
  offset: number
): Promise<ReadResourceChunkWindow> {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  if (!Number.isFinite(offset)) {
    throw new Error('Invalid offset')
  }

  const requestedOffset = Math.floor(offset)
  const resource = loadResourceCache(resourceId)
  if (!resource) {
    throw new Error(`Resource cache not found for ID: ${resourceId}`)
  }

  const chunks = resource.chunks
    .map((chunk) => {
      const text = chunk.text || ''
      const start =
        typeof chunk.offset === 'number' && Number.isFinite(chunk.offset) ? chunk.offset : 0
      const end =
        typeof chunk.endOffset === 'number' && Number.isFinite(chunk.endOffset)
          ? chunk.endOffset
          : start + text.length
      return {
        text,
        offset: start,
        endOffset: end
      }
    })
    .filter((chunk) => chunk.text.length > 0 && chunk.endOffset > chunk.offset)
    .sort((a, b) => a.offset - b.offset)

  if (chunks.length === 0) {
    throw new Error(`No readable cached chunks found in resource ID: ${resourceId}`)
  }

  const formatRanges = (): string =>
    chunks.map((chunk) => `${chunk.offset}-${chunk.endOffset}`).join(', ')

  const containing = chunks.find(
    (chunk) => chunk.offset <= requestedOffset && chunk.endOffset > requestedOffset
  )
  if (containing) {
    return {
      ...containing,
      requestedOffset,
      ...(containing.offset !== requestedOffset
        ? {
            warning: `Requested offset ${requestedOffset} falls inside cached chunk ${containing.offset}-${containing.endOffset}; returned the full cached chunk from offset ${containing.offset}.`
          }
        : {})
    }
  }

  const first = chunks[0]
  if (requestedOffset < first.offset) {
    return {
      ...first,
      requestedOffset,
      warning: `Requested offset ${requestedOffset} is before the first cached chunk. Returned the first readable chunk ${first.offset}-${first.endOffset}. Cached ranges: ${formatRanges()}.`
    }
  }

  const next = chunks.find((chunk) => chunk.offset > requestedOffset)
  if (next) {
    return {
      ...next,
      requestedOffset,
      warning: `Requested offset ${requestedOffset} is not cached. Returned the next readable chunk ${next.offset}-${next.endOffset}. Cached ranges: ${formatRanges()}.`
    }
  }

  const last = chunks[chunks.length - 1]
  const resourceLength =
    typeof resource.totalChars === 'number' && Number.isFinite(resource.totalChars)
      ? ` Resource length is ${resource.totalChars}.`
      : ''
  return {
    ...last,
    requestedOffset,
    warning: `Requested offset ${requestedOffset} is beyond cached content.${resourceLength} Returned the last readable chunk ${last.offset}-${last.endOffset}. Cached ranges: ${formatRanges()}.`
  }
}

// Look up a cached link by its inline id (for click_link).
export function getCachedLink(resourceId: string, linkId: number): CachedLink | null {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  return getResourceLink(resourceId, linkId)
}

// Grep a cached resource's full text, returning matching lines with 1-indexed line numbers.
export function findInResource(resourceId: string, query: string, maxMatches = 15): FindMatch[] {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new Error('Invalid resource ID')
  }
  const fullText = getResourceFullText(resourceId)
  if (!fullText) return []

  const needle = query.toLowerCase()
  const lines = fullText.split('\n')
  const matches: FindMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      matches.push({ lineNumber: i + 1, text: lines[i] })
      if (matches.length >= maxMatches) break
    }
  }
  return matches
}
