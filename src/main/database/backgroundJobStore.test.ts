import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { closeDb } from './connection'
import {
  getBackgroundJobRecord,
  listBackgroundJobRecords,
  pruneBackgroundJobRecords,
  recoverRunningBackgroundJobs,
  saveBackgroundJob
} from './backgroundJobStore'
import { describeWithSqlite } from '../testSupport/nativeSqlite'

const testDir = join(__dirname, '../../../temp-background-job-store-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describeWithSqlite('backgroundJobStore', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('persists jobs and filters them by session', () => {
    saveBackgroundJob({
      id: 'job-1',
      type: 'subagent',
      title: 'Research',
      description: 'Inspect the project',
      sessionId: 'session-1',
      status: 'running',
      createdAt: 10,
      updatedAt: 10
    })
    saveBackgroundJob({
      id: 'job-2',
      type: 'subagent',
      title: 'Other',
      sessionId: 'session-2',
      status: 'completed',
      createdAt: 20,
      updatedAt: 30,
      completedAt: 30
    })

    expect(getBackgroundJobRecord('job-1')).toMatchObject({
      description: 'Inspect the project',
      sessionId: 'session-1',
      status: 'running'
    })
    expect(listBackgroundJobRecords('session-1').map((job) => job.id)).toEqual(['job-1'])
    expect(listBackgroundJobRecords().map((job) => job.id)).toEqual(['job-2', 'job-1'])
  })

  it('marks unfinished jobs as interrupted after restart', () => {
    saveBackgroundJob({
      id: 'job-running',
      type: 'subagent',
      title: 'Inspect',
      status: 'running',
      createdAt: 10,
      updatedAt: 10
    })

    expect(recoverRunningBackgroundJobs(50)).toBe(1)
    expect(getBackgroundJobRecord('job-running')).toMatchObject({
      status: 'interrupted',
      completedAt: 50,
      updatedAt: 50
    })
  })

  it('prunes expired terminal jobs but preserves running jobs', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const expired = now - 8 * 24 * 60 * 60 * 1000
    saveBackgroundJob({
      id: 'job-expired',
      type: 'subagent',
      title: 'Expired',
      status: 'completed',
      createdAt: expired,
      updatedAt: expired,
      completedAt: expired
    })
    saveBackgroundJob({
      id: 'job-running',
      type: 'subagent',
      title: 'Running',
      status: 'running',
      createdAt: expired,
      updatedAt: expired
    })

    expect(pruneBackgroundJobRecords(now)).toBe(1)
    expect(getBackgroundJobRecord('job-expired')).toBeUndefined()
    expect(getBackgroundJobRecord('job-running')?.status).toBe('running')
  })
})
