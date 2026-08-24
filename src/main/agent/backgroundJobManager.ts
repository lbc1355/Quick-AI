import type {
  BackgroundJobInfo,
  BackgroundJobReportDisposition,
  BackgroundJobStatus
} from '../../shared/types'
import { resetBackgroundWakeBudget } from './backgroundWakeBudget'

export interface BackgroundJobRunResult {
  status?: Exclude<BackgroundJobStatus, 'running' | 'interrupted'>
  error?: string
}

export interface StartBackgroundJobInput {
  id: string
  type: string
  title: string
  description?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  output?: string
  run: (signal: AbortSignal) => Promise<void | BackgroundJobRunResult>
}

export type BackgroundJobUpdate = Partial<
  Pick<BackgroundJobInfo, 'title' | 'description' | 'metadata' | 'output' | 'error'>
>

export interface BackgroundJobPersistence {
  get: (id: string) => BackgroundJobInfo | undefined
  list: (sessionId?: string) => BackgroundJobInfo[]
  save: (job: BackgroundJobInfo) => BackgroundJobInfo
  prune: () => number
}

interface LiveBackgroundJob {
  info: BackgroundJobInfo
  controller: AbortController
}

const COMPLETED_JOB_TTL_MS = 60 * 60 * 1000
const MAX_RETAINED_LIVE_JOBS = 200

const jobs = new Map<string, LiveBackgroundJob>()
let persistence: BackgroundJobPersistence | undefined

const snapshot = (job: BackgroundJobInfo): BackgroundJobInfo => ({
  ...job,
  ...(job.metadata ? { metadata: { ...job.metadata } } : {})
})

const save = (job: BackgroundJobInfo): void => {
  persistence?.save(snapshot(job))
}

const pruneLive = (now = Date.now()): void => {
  for (const [id, job] of jobs) {
    if (
      job.info.status !== 'running' &&
      now - (job.info.completedAt || job.info.createdAt) > COMPLETED_JOB_TTL_MS
    ) {
      jobs.delete(id)
    }
  }

  if (jobs.size <= MAX_RETAINED_LIVE_JOBS) return
  const removable = Array.from(jobs.values())
    .filter((job) => job.info.status !== 'running')
    .sort(
      (a, b) => (a.info.completedAt || a.info.createdAt) - (b.info.completedAt || b.info.createdAt)
    )
  for (const job of removable) {
    if (jobs.size <= MAX_RETAINED_LIVE_JOBS) break
    jobs.delete(job.info.id)
  }
}

export function configureBackgroundJobPersistence(
  next: BackgroundJobPersistence | undefined
): void {
  persistence = next
}

export function startBackgroundJob(input: StartBackgroundJobInput): BackgroundJobInfo {
  pruneLive()
  persistence?.prune()
  const existing = jobs.get(input.id)?.info || persistence?.get(input.id)
  if (existing?.status === 'running') return snapshot(existing)

  const controller = new AbortController()
  const now = Date.now()
  const info: BackgroundJobInfo = {
    id: input.id,
    type: input.type,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    status: 'running',
    createdAt: now,
    updatedAt: now
  }
  const job: LiveBackgroundJob = { info, controller }
  jobs.set(info.id, job)
  save(info)

  void input
    .run(controller.signal)
    .then((result) => {
      if (info.status !== 'running') return
      info.status = result?.status || 'completed'
      info.error = result?.error
      info.completedAt = Date.now()
      info.updatedAt = info.completedAt
      save(info)
    })
    .catch((error: unknown) => {
      if (info.status !== 'running') return
      info.status = controller.signal.aborted ? 'cancelled' : 'failed'
      info.error = error instanceof Error ? error.message : String(error)
      info.completedAt = Date.now()
      info.updatedAt = info.completedAt
      save(info)
    })
    .finally(() => {
      pruneLive()
      persistence?.prune()
    })

  return snapshot(info)
}

export function getBackgroundJob(id: string): BackgroundJobInfo | undefined {
  const job = jobs.get(id)?.info || persistence?.get(id)
  return job ? snapshot(job) : undefined
}

/** Return a job only to its owning conversation. Undefined owners match for legacy/test jobs. */
export function getBackgroundJobForSession(
  id: string,
  sessionId: string | undefined
): BackgroundJobInfo | undefined {
  const job = getBackgroundJob(id)
  return job?.sessionId === sessionId ? job : undefined
}

/** Record the first result delivery/read. Later attempts preserve the original disposition. */
export function markBackgroundJobReported(
  id: string,
  disposition: BackgroundJobReportDisposition,
  now = Date.now()
): BackgroundJobInfo | undefined {
  const live = jobs.get(id)
  const info = live?.info || persistence?.get(id)
  if (!info) return undefined
  if (info.reportedAt !== undefined) return snapshot(info)
  info.reportedAt = now
  info.reportDisposition = disposition
  info.updatedAt = now
  save(info)
  return snapshot(info)
}

/** Persist progress for a running task without changing its lifecycle status. */
export function updateBackgroundJob(
  id: string,
  patch: BackgroundJobUpdate
): BackgroundJobInfo | undefined {
  const live = jobs.get(id)
  const info = live?.info || persistence?.get(id)
  if (!info) return undefined

  if (patch.title !== undefined) info.title = patch.title
  if (patch.description !== undefined) info.description = patch.description
  if (patch.metadata !== undefined) info.metadata = { ...patch.metadata }
  if (patch.output !== undefined) info.output = patch.output
  if (patch.error !== undefined) info.error = patch.error
  info.updatedAt = Date.now()
  save(info)
  return snapshot(info)
}

export function listBackgroundJobs(sessionId?: string): BackgroundJobInfo[] {
  pruneLive()
  persistence?.prune()
  const merged = new Map<string, BackgroundJobInfo>()
  for (const job of persistence?.list(sessionId) || []) merged.set(job.id, job)
  for (const { info } of jobs.values()) {
    if (sessionId && info.sessionId !== sessionId) continue
    merged.set(info.id, snapshot(info))
  }
  return Array.from(merged.values()).sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)
  )
}

export function cancelBackgroundJob(id: string): BackgroundJobInfo | undefined {
  const live = jobs.get(id)
  const info = live?.info || persistence?.get(id)
  if (!info) return undefined
  if (info.status === 'running') {
    info.status = live ? 'cancelled' : 'interrupted'
    info.error = live ? undefined : '后台任务的运行进程已不存在。'
    info.completedAt = Date.now()
    info.updatedAt = info.completedAt
    live?.controller.abort()
    save(info)
  }
  return snapshot(info)
}

export function cancelBackgroundJobForSession(
  id: string,
  sessionId: string | undefined
): BackgroundJobInfo | undefined {
  const job = getBackgroundJobForSession(id, sessionId)
  return job ? cancelBackgroundJob(job.id) : undefined
}

/**
 * Cancel and forget every live background job that belongs to a deleted session.
 *
 * Removing the in-memory entry is important: a background shell flushes its final output after the
 * process closes. If the cancelled job remained in `jobs`, that late update would persist it again
 * after the session's database rows had already been deleted.
 */
export function discardBackgroundJobsForSession(sessionId: string): number {
  resetBackgroundWakeBudget(sessionId)
  const ids = Array.from(jobs.entries())
    .filter(([, job]) => job.info.sessionId === sessionId)
    .map(([id]) => id)

  for (const id of ids) {
    cancelBackgroundJob(id)
    jobs.delete(id)
  }
  return ids.length
}

export function clearBackgroundJobsForTests(): void {
  for (const job of jobs.values()) job.controller.abort()
  jobs.clear()
  persistence = undefined
}
