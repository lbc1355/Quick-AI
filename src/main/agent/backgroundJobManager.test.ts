import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelBackgroundJob,
  clearBackgroundJobsForTests,
  getBackgroundJob,
  startBackgroundJob
} from './backgroundJobManager'

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
})
