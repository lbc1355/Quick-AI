import { afterEach, describe, expect, it } from 'vitest'
import { ActionLog } from '../agent/actionLog'
import { createRun, destroyRun } from '../agent/AgentRunContext'
import {
  clearBackgroundJobsForTests,
  getBackgroundJob,
  startBackgroundJob
} from '../agent/backgroundJobManager'
import { backgroundJobReadTool } from './backgroundJobTool'

const signal = new AbortController().signal

describe('background_job_read', () => {
  afterEach(() => {
    destroyRun('run-owner')
    destroyRun('run-other')
    clearBackgroundJobsForTests()
  })

  it('reads and acknowledges a persisted result owned by the current session', async () => {
    createRun('run-owner', [], 'all', new ActionLog(), undefined, 'session-1')
    startBackgroundJob({
      id: 'job-1',
      type: 'subagent',
      title: 'Inspect',
      sessionId: 'session-1',
      output: 'Inspection complete',
      run: async () => undefined
    })
    await Promise.resolve()
    await Promise.resolve()

    const result = await backgroundJobReadTool.execute(
      { jobId: 'job-1' },
      { reqId: 'run-owner', signal }
    )

    expect(result.resultForModel).toContain('Inspection complete')
    expect(getBackgroundJob('job-1')).toMatchObject({
      reportDisposition: 'read',
      reportedAt: expect.any(Number)
    })
  })

  it("does not expose another session's job", async () => {
    createRun('run-other', [], 'all', new ActionLog(), undefined, 'session-2')
    startBackgroundJob({
      id: 'job-private',
      type: 'shell',
      title: 'Build',
      sessionId: 'session-1',
      output: 'secret output',
      run: () => new Promise<void>(() => undefined)
    })

    await expect(
      backgroundJobReadTool.execute({ jobId: 'job-private' }, { reqId: 'run-other', signal })
    ).rejects.toThrow('not found in this conversation')
  })
})
