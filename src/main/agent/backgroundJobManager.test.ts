import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelBackgroundJob,
  clearBackgroundJobsForTests,
  configureBackgroundJobPersistence,
  discardBackgroundJobsForSession,
  getBackgroundJob,
  listBackgroundJobs,
  startBackgroundJob,
  updateBackgroundJob
} from './backgroundJobManager'
import type { BackgroundJobInfo } from '../../shared/types'

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('background job manager', () => {
  afterEach(() => clearBackgroundJobsForTests())

  it('returns immediately and records completion later', async () => {
    let finish: (() => void) | undefined
    const started = startBackgroundJob({
      id: 'job-1',
      type: 'subagent',
      title: 'Inspect',
      run: () => new Promise<void>((resolve) => (finish = resolve))
    })

    expect(started.status).toBe('running')
    expect(getBackgroundJob('job-1')?.status).toBe('running')

    finish?.()
    await flush()

    expect(getBackgroundJob('job-1')?.status).toBe('completed')
  })

  it('aborts and marks a running job as cancelled', () => {
    let observedSignal: AbortSignal | undefined
    startBackgroundJob({
      id: 'job-cancel',
      type: 'subagent',
      title: 'Inspect',
      run: (signal) => {
        observedSignal = signal
        return new Promise<void>(() => undefined)
      }
    })

    expect(cancelBackgroundJob('job-cancel')?.status).toBe('cancelled')
    expect(observedSignal?.aborted).toBe(true)
  })

  it('cancels and forgets every live job belonging to a deleted session', () => {
    startBackgroundJob({
      id: 'job-a',
      type: 'shell',
      title: 'A',
      sessionId: 'session-1',
      run: () => new Promise<void>(() => undefined)
    })
    startBackgroundJob({
      id: 'job-b',
      type: 'shell',
      title: 'B',
      sessionId: 'session-2',
      run: () => new Promise<void>(() => undefined)
    })

    const discarded = discardBackgroundJobsForSession('session-1')
    expect(discarded).toBe(1)
    expect(getBackgroundJob('job-a')).toBeUndefined()
    expect(getBackgroundJob('job-b')?.status).toBe('running')
  })

  it('rejects late output updates after a deleted session job is discarded', () => {
    const records = new Map<string, BackgroundJobInfo>()
    configureBackgroundJobPersistence({
      get: (id) => records.get(id),
      list: () => Array.from(records.values()),
      save: (job) => {
        records.set(job.id, { ...job })
        return job
      },
      prune: () => 0
    })

    let observedSignal: AbortSignal | undefined
    startBackgroundJob({
      id: 'job-deleted-session',
      type: 'shell',
      title: 'Build',
      sessionId: 'session-deleted',
      run: (signal) => {
        observedSignal = signal
        return new Promise<void>(() => undefined)
      }
    })

    expect(discardBackgroundJobsForSession('session-deleted')).toBe(1)
    expect(observedSignal?.aborted).toBe(true)

    // Mirrors deleteSessionScopedRows: cancellation is persisted first, then the database row is
    // deleted. A background shell may still try to flush buffered output after this point.
    records.delete('job-deleted-session')
    expect(
      updateBackgroundJob('job-deleted-session', { output: 'late buffered output' })
    ).toBeUndefined()
    expect(records.has('job-deleted-session')).toBe(false)
  })

  it('records a max-steps outcome returned by the job', async () => {
    startBackgroundJob({
      id: 'job-limited',
      type: 'subagent',
      title: 'Inspect',
      run: async () => ({ status: 'max_steps' })
    })

    await flush()

    expect(getBackgroundJob('job-limited')?.status).toBe('max_steps')
  })

  it('persists task-specific metadata and bounded output updates', () => {
    const metadata = { pid: 42, totalOutputChars: 0 }
    startBackgroundJob({
      id: 'job-output',
      type: 'shell',
      title: 'Build',
      metadata,
      output: '',
      run: () => new Promise<void>(() => undefined)
    })
    metadata.pid = 99

    updateBackgroundJob('job-output', {
      metadata: { pid: 42, totalOutputChars: 5 },
      output: 'hello'
    })

    expect(getBackgroundJob('job-output')).toMatchObject({
      metadata: { pid: 42, totalOutputChars: 5 },
      output: 'hello'
    })
  })

  it('persists lifecycle changes and merges recovered records into listings', async () => {
    const records = new Map<string, BackgroundJobInfo>([
      [
        'job-recovered',
        {
          id: 'job-recovered',
          type: 'subagent',
          title: 'Recovered',
          sessionId: 'session-1',
          status: 'interrupted',
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2
        }
      ]
    ])
    configureBackgroundJobPersistence({
      get: (id) => records.get(id),
      list: (sessionId) =>
        Array.from(records.values()).filter((job) => !sessionId || job.sessionId === sessionId),
      save: (job) => {
        records.set(job.id, { ...job })
        return job
      },
      prune: () => 0
    })

    startBackgroundJob({
      id: 'job-live',
      type: 'subagent',
      title: 'Live',
      sessionId: 'session-1',
      run: async () => undefined
    })
    await flush()

    expect(records.get('job-live')?.status).toBe('completed')
    expect(listBackgroundJobs('session-1').map((job) => job.id)).toEqual([
      'job-live',
      'job-recovered'
    ])
  })
})
