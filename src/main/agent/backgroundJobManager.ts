export type BackgroundJobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface BackgroundJobInfo {
  id: string
  type: string
  title: string
  status: BackgroundJobStatus
  createdAt: number
  completedAt?: number
  error?: string
}

export interface StartBackgroundJobInput {
  id: string
  type: string
  title: string
  run: (signal: AbortSignal) => Promise<void>
}

const COMPLETED_JOB_TTL_MS = 60 * 60 * 1000
const MAX_RETAINED_JOBS = 200

const jobs = new Map<string, BackgroundJobInfo & { controller: AbortController }>()

const snapshot = (job: BackgroundJobInfo): BackgroundJobInfo => ({ ...job })

const prune = (now = Date.now()): void => {
  for (const [id, job] of jobs) {
    if (
      job.status !== 'running' &&
      now - (job.completedAt || job.createdAt) > COMPLETED_JOB_TTL_MS
    ) {
      jobs.delete(id)
    }
  }

  if (jobs.size <= MAX_RETAINED_JOBS) return
  const removable = Array.from(jobs.values())
    .filter((job) => job.status !== 'running')
    .sort((a, b) => (a.completedAt || a.createdAt) - (b.completedAt || b.createdAt))
  for (const job of removable) {
    if (jobs.size <= MAX_RETAINED_JOBS) break
    jobs.delete(job.id)
  }
}

export function startBackgroundJob(input: StartBackgroundJobInput): BackgroundJobInfo {
  prune()
  const existing = jobs.get(input.id)
  if (existing?.status === 'running') return snapshot(existing)

  const controller = new AbortController()
  const job: BackgroundJobInfo & { controller: AbortController } = {
    id: input.id,
    type: input.type,
    title: input.title,
    status: 'running',
    createdAt: Date.now(),
    controller
  }
  jobs.set(job.id, job)

  void input
    .run(controller.signal)
    .then(() => {
      if (job.status !== 'running') return
      job.status = 'completed'
      job.completedAt = Date.now()
    })
    .catch((error: unknown) => {
      if (job.status !== 'running') return
      job.status = controller.signal.aborted ? 'cancelled' : 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.completedAt = Date.now()
    })
    .finally(() => prune())

  return snapshot(job)
}

export function getBackgroundJob(id: string): BackgroundJobInfo | undefined {
  const job = jobs.get(id)
  return job ? snapshot(job) : undefined
}

export function listBackgroundJobs(): BackgroundJobInfo[] {
  prune()
  return Array.from(jobs.values(), snapshot).sort((a, b) => a.createdAt - b.createdAt)
}

export function cancelBackgroundJob(id: string): BackgroundJobInfo | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  if (job.status === 'running') {
    job.status = 'cancelled'
    job.completedAt = Date.now()
    job.controller.abort()
  }
  return snapshot(job)
}

export function clearBackgroundJobsForTests(): void {
  for (const job of jobs.values()) job.controller.abort()
  jobs.clear()
}
