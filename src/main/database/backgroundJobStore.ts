import type { BackgroundJobInfo } from '../../shared/types'
import { getDb } from './connection'

interface BackgroundJobRow {
  id: string
  type: string
  title: string
  description: string | null
  sessionId: string | null
  status: BackgroundJobInfo['status']
  error: string | null
  metadata: string | null
  output: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  reportedAt: number | null
  reportDisposition: BackgroundJobInfo['reportDisposition'] | null
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RETAINED_JOBS = 200
const INTERRUPTED_ERROR = '应用已退出，后台任务未能继续运行。'

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const parseMetadata = (value: string | null): Record<string, unknown> | undefined => {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const rowToJob = (row: BackgroundJobRow): BackgroundJobInfo => {
  const metadata = parseMetadata(row.metadata)
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt !== null ? { completedAt: row.completedAt } : {}),
    ...(row.reportedAt !== null ? { reportedAt: row.reportedAt } : {}),
    ...(row.reportDisposition ? { reportDisposition: row.reportDisposition } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(metadata ? { metadata } : {}),
    ...(row.output !== null ? { output: row.output } : {})
  }
}

export function saveBackgroundJob(job: BackgroundJobInfo): BackgroundJobInfo {
  const normalized: BackgroundJobInfo = {
    id: requireText(job.id, 'Background job id'),
    type: requireText(job.type, 'Background job type'),
    title: requireText(job.title, 'Background job title'),
    ...(optionalText(job.description) ? { description: optionalText(job.description) } : {}),
    ...(optionalText(job.sessionId) ? { sessionId: optionalText(job.sessionId) } : {}),
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    ...(job.reportedAt !== undefined ? { reportedAt: job.reportedAt } : {}),
    ...(job.reportDisposition ? { reportDisposition: job.reportDisposition } : {}),
    ...(optionalText(job.error) ? { error: optionalText(job.error) } : {}),
    ...(job.metadata ? { metadata: { ...job.metadata } } : {}),
    ...(job.output !== undefined ? { output: job.output } : {})
  }

  getDb()
    .prepare(
      `INSERT INTO background_jobs
       (id, type, title, description, sessionId, status, error, metadata, output, createdAt, updatedAt, completedAt, reportedAt, reportDisposition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         description = excluded.description,
         sessionId = excluded.sessionId,
         status = excluded.status,
         error = excluded.error,
         metadata = excluded.metadata,
         output = excluded.output,
         updatedAt = excluded.updatedAt,
         completedAt = excluded.completedAt,
         reportedAt = excluded.reportedAt,
         reportDisposition = excluded.reportDisposition`
    )
    .run(
      normalized.id,
      normalized.type,
      normalized.title,
      normalized.description ?? null,
      normalized.sessionId ?? null,
      normalized.status,
      normalized.error ?? null,
      normalized.metadata ? JSON.stringify(normalized.metadata) : null,
      normalized.output ?? null,
      normalized.createdAt,
      normalized.updatedAt,
      normalized.completedAt ?? null,
      normalized.reportedAt ?? null,
      normalized.reportDisposition ?? null
    )

  return normalized
}

export function getBackgroundJobRecord(id: string): BackgroundJobInfo | undefined {
  const row = getDb()
    .prepare('SELECT * FROM background_jobs WHERE id = ?')
    .get(requireText(id, 'Background job id')) as BackgroundJobRow | undefined
  return row ? rowToJob(row) : undefined
}

export function listBackgroundJobRecords(sessionId?: string): BackgroundJobInfo[] {
  const normalizedSessionId = optionalText(sessionId)
  const rows = (
    normalizedSessionId
      ? getDb()
          .prepare(
            'SELECT * FROM background_jobs WHERE sessionId = ? ORDER BY createdAt DESC, id DESC'
          )
          .all(normalizedSessionId)
      : getDb().prepare('SELECT * FROM background_jobs ORDER BY createdAt DESC, id DESC').all()
  ) as BackgroundJobRow[]
  return rows.map(rowToJob)
}

/** Mark jobs whose owning process disappeared as interrupted during startup. */
export function recoverRunningBackgroundJobs(now = Date.now()): number {
  const result = getDb()
    .prepare(
      `UPDATE background_jobs
       SET status = 'interrupted',
           error = CASE WHEN error IS NULL OR error = '' THEN ? ELSE error END,
           updatedAt = ?,
           completedAt = ?
       WHERE status = 'running'`
    )
    .run(INTERRUPTED_ERROR, now, now)
  return result.changes
}

export function pruneBackgroundJobRecords(now = Date.now()): number {
  const database = getDb()
  return database.transaction((): number => {
    let removed = database
      .prepare(
        `DELETE FROM background_jobs
         WHERE status <> 'running' AND COALESCE(completedAt, updatedAt) < ?`
      )
      .run(now - RETENTION_MS).changes

    const count = (
      database.prepare('SELECT COUNT(*) AS count FROM background_jobs').get() as { count: number }
    ).count
    const overflow = Math.max(0, count - MAX_RETAINED_JOBS)
    if (overflow > 0) {
      removed += database
        .prepare(
          `DELETE FROM background_jobs
           WHERE id IN (
             SELECT id FROM background_jobs
             WHERE status <> 'running'
             ORDER BY COALESCE(completedAt, updatedAt) ASC, id ASC
             LIMIT ?
           )`
        )
        .run(overflow).changes
    }
    return removed
  })()
}
