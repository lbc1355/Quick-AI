import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { copyRunCheckpointsForRuns, loadRunCheckpoint, saveRunCheckpoint } from './runCheckpoint'
import { copyRunManifestsForRuns, createRunManifest, loadRunManifest } from './runManifest'

const testUserData = join(tmpdir(), 'quickai-run-fork-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserData
  }
}))

describe('run fork persistence', () => {
  beforeEach(() => {
    rmSync(testUserData, { recursive: true, force: true })
  })

  it('copies selected run checkpoints into the target session', () => {
    saveRunCheckpoint({
      sessionId: 'source',
      reqId: 'run-1',
      step: 2,
      messages: [{ role: 'user', content: 'hello' }],
      activeTools: ['fetch_url'],
      lastCompletedCallId: 'call-1'
    })
    saveRunCheckpoint({
      sessionId: 'source',
      reqId: 'run-2',
      step: 1,
      messages: [{ role: 'user', content: 'future' }],
      activeTools: []
    })

    expect(copyRunCheckpointsForRuns('source', 'target', ['run-1'])).toBe(1)
    expect(loadRunCheckpoint('target', 'run-1')).toMatchObject({
      sessionId: 'target',
      reqId: 'run-1',
      step: 2,
      lastCompletedCallId: 'call-1'
    })
    expect(loadRunCheckpoint('target', 'run-2')).toBeUndefined()
  })

  it('copies selected run manifests into the target session', () => {
    createRunManifest({
      sessionId: 'source',
      runId: 'run-1',
      sourceMessageId: 'u1',
      assistantMessageId: 'a1'
    })
    createRunManifest({
      sessionId: 'source',
      runId: 'run-2',
      sourceMessageId: 'u2',
      assistantMessageId: 'a2'
    })

    expect(copyRunManifestsForRuns('source', 'target', ['run-1'])).toBe(1)
    expect(loadRunManifest('target', 'run-1')).toMatchObject({
      sessionId: 'target',
      runId: 'run-1',
      sourceMessageId: 'u1',
      assistantMessageId: 'a1'
    })
    expect(loadRunManifest('target', 'run-2')).toBeUndefined()
  })
})
