import { SessionResourceChunk } from '../../shared/types'
import { getDb } from './connection'

export function loadResourceCache(resourceId: string): {
  id: string
  kind: string
  source: string
  title: string | null
  fingerprint: string | null
  totalChars: number | null
  fetchedRanges: string
  nextOffset: number | null
  status: string
  summary: string | null
  createdAt: number
  updatedAt: number
  chunks: Array<{
    id: string
    offset: number | null
    endOffset: number | null
    page: number | null
    section: string | null
    text: string | null
    summary: string | null
    createdAt: number
  }>
} | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM resource_cache WHERE id = ?').get(resourceId) as {
    id: string
    kind: string
    source: string
    title: string | null
    fingerprint: string | null
    totalChars: number | null
    fetchedRanges: string
    nextOffset: number | null
    status: string
    summary: string | null
    createdAt: number
    updatedAt: number
  } | null

  if (!row) return null

  const chunks = database
    .prepare('SELECT * FROM resource_chunks WHERE resourceId = ? ORDER BY offset ASC')
    .all(resourceId) as Array<{
    id: string
    offset: number | null
    endOffset: number | null
    page: number | null
    section: string | null
    text: string | null
    summary: string | null
    createdAt: number
  }>

  return { ...row, chunks }
}

export function upsertResourceCache(
  resourceId: string,
  kind: string,
  source: string,
  title: string | undefined,
  totalChars: number | undefined,
  fetchedRanges: string,
  nextOffset: number | undefined,
  status: string,
  summary: string | undefined,
  now: number
): void {
  const database = getDb()
  const existing = database.prepare('SELECT id FROM resource_cache WHERE id = ?').get(resourceId)

  if (existing) {
    database
      .prepare(
        `UPDATE resource_cache SET
         kind = ?, source = ?, title = ?, totalChars = ?, fetchedRanges = ?,
         nextOffset = ?, status = ?, summary = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        kind,
        source,
        title || null,
        totalChars ?? null,
        fetchedRanges,
        nextOffset ?? null,
        status,
        summary || null,
        now,
        resourceId
      )
  } else {
    database
      .prepare(
        `INSERT INTO resource_cache
         (id, kind, source, title, fingerprint, totalChars, fetchedRanges, nextOffset, status, summary, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        resourceId,
        kind,
        source,
        title || null,
        null,
        totalChars ?? null,
        fetchedRanges,
        nextOffset ?? null,
        status,
        summary || null,
        now,
        now
      )
  }
}

export function upsertResourceChunk(resourceId: string, chunk: SessionResourceChunk): void {
  const database = getDb()
  database
    .prepare(
      `INSERT OR REPLACE INTO resource_chunks
       (id, resourceId, offset, endOffset, page, section, text, summary, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      chunk.id,
      resourceId,
      chunk.offset ?? null,
      chunk.endOffset ?? null,
      chunk.page ?? null,
      chunk.section || null,
      chunk.text || null,
      chunk.summary || null,
      chunk.createdAt
    )
}

export function deleteResourceFromDb(resourceId: string): void {
  const database = getDb()
  database.prepare('DELETE FROM resource_cache WHERE id = ?').run(resourceId)
}

export function getResourceChunkText(resourceId: string, offset: number): string | null {
  const database = getDb()

  // Exact offset match first
  let row = database
    .prepare('SELECT text FROM resource_chunks WHERE resourceId = ? AND offset = ?')
    .get(resourceId, offset) as { text: string | null } | undefined

  if (row && row.text) return row.text

  // Range overlap fallback
  row = database
    .prepare(
      `SELECT text FROM resource_chunks
       WHERE resourceId = ? AND offset <= ? AND endOffset > ?
       ORDER BY offset ASC LIMIT 1`
    )
    .get(resourceId, offset, offset) as { text: string | null } | undefined

  return row?.text || null
}

export function pruneResourceChunks(resourceId: string, maxTextChars: number): void {
  const database = getDb()
  const chunks = database
    .prepare('SELECT id, text FROM resource_chunks WHERE resourceId = ? ORDER BY createdAt ASC')
    .all(resourceId) as Array<{ id: string; text: string | null }>

  let totalChars = chunks.reduce((sum, c) => sum + (c.text?.length || 0), 0)
  const idsToDelete: string[] = []
  for (const chunk of chunks) {
    if (totalChars <= maxTextChars) break
    idsToDelete.push(chunk.id)
    totalChars -= chunk.text?.length || 0
  }

  if (idsToDelete.length === 0) return

  // Single batched DELETE inside a transaction instead of one round-trip per chunk.
  const placeholders = idsToDelete.map(() => '?').join(', ')
  database
    .prepare(`DELETE FROM resource_chunks WHERE resourceId = ? AND id IN (${placeholders})`)
    .run(resourceId, ...idsToDelete)
}

export function getResourceChunksMetadata(
  resourceId: string
): Array<{ id: string; offset: number | null; endOffset: number | null; createdAt: number }> {
  const database = getDb()
  return database
    .prepare('SELECT id, offset, endOffset, createdAt FROM resource_chunks WHERE resourceId = ?')
    .all(resourceId) as Array<{
    id: string
    offset: number | null
    endOffset: number | null
    createdAt: number
  }>
}

// Resource Links (for click_link)

export function saveResourceLinks(
  resourceId: string,
  links: Array<{ id: number; text: string; href: string }>
): void {
  const database = getDb()
  database.prepare('DELETE FROM resource_links WHERE resourceId = ?').run(resourceId)
  if (links.length === 0) return
  const insert = database.prepare(
    'INSERT OR REPLACE INTO resource_links (resourceId, linkId, text, href) VALUES (?, ?, ?, ?)'
  )
  for (const link of links) {
    insert.run(resourceId, link.id, link.text, link.href)
  }
}

export function loadResourceLinks(
  resourceId: string
): Array<{ id: number; text: string; href: string }> {
  const database = getDb()
  const rows = database
    .prepare(
      'SELECT linkId, text, href FROM resource_links WHERE resourceId = ? ORDER BY linkId ASC'
    )
    .all(resourceId) as Array<{ linkId: number; text: string; href: string }>
  return rows.map((r) => ({ id: r.linkId, text: r.text, href: r.href }))
}

export function getResourceLink(
  resourceId: string,
  linkId: number
): { id: number; text: string; href: string } | null {
  const database = getDb()
  const row = database
    .prepare('SELECT linkId, text, href FROM resource_links WHERE resourceId = ? AND linkId = ?')
    .get(resourceId, linkId) as { linkId: number; text: string; href: string } | undefined
  return row ? { id: row.linkId, text: row.text, href: row.href } : null
}

// Concatenate all cached chunk texts in offset order — used by find_in_page.
export function getResourceFullText(resourceId: string): string {
  const database = getDb()
  const rows = database
    .prepare('SELECT text FROM resource_chunks WHERE resourceId = ? ORDER BY offset ASC')
    .all(resourceId) as Array<{ text: string | null }>
  return rows.map((r) => r.text || '').join('')
}
