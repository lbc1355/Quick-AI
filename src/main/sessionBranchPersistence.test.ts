import { vi, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import { closeDb, loadSessions, saveSessions } from './database'
import { Session } from '../shared/types'
import { describeWithSqlite } from './testSupport/nativeSqlite'

const testDir = join(__dirname, '../../temp-session-branch-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describeWithSqlite('session branch metadata persistence', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('round-trips session.branchOf and message fork metadata through save/load', () => {
    const sessions: Session[] = [
      {
        id: 'source',
        title: '源会话',
        lastActiveTime: 100,
        messages: [{ id: '1', role: 'user', content: 'hi' }]
      },
      {
        id: 'branch',
        title: '源会话 分支',
        lastActiveTime: 200,
        branchOf: { sessionId: 'source', messageId: '1', runId: 'run-abc' },
        messages: [
          { id: '2', role: 'user', content: 'edited prompt' },
          {
            id: '3',
            role: 'assistant',
            content: 'forked reply',
            agentRunId: 'run-xyz',
            isBranchFork: true,
            forkedFrom: { sessionId: 'source', messageId: '1', runId: 'run-abc' }
          }
        ]
      }
    ]

    saveSessions(sessions)
    closeDb()
    const loaded = loadSessions()

    const branch = loaded.find((s) => s.id === 'branch')
    expect(branch?.branchOf).toEqual({ sessionId: 'source', messageId: '1', runId: 'run-abc' })

    const forkMsg = branch?.messages.find((m) => m.id === '3')
    expect(forkMsg?.isBranchFork).toBe(true)
    expect(forkMsg?.forkedFrom).toEqual({ sessionId: 'source', messageId: '1', runId: 'run-abc' })

    // A non-branch session/message carries no spurious metadata.
    const source = loaded.find((s) => s.id === 'source')
    expect(source?.branchOf).toBeUndefined()
    expect(source?.messages[0].forkedFrom).toBeUndefined()
    expect(source?.messages[0].isBranchFork).toBeUndefined()
  })

  it('persists a branchOf without a runId (runId omitted, not null)', () => {
    saveSessions([
      {
        id: 'b',
        title: 'b',
        lastActiveTime: 1,
        branchOf: { sessionId: 'src', messageId: 'm1' },
        messages: []
      }
    ])
    closeDb()
    const branch = loadSessions().find((s) => s.id === 'b')
    expect(branch?.branchOf).toEqual({ sessionId: 'src', messageId: 'm1' })
    expect(branch?.branchOf && 'runId' in branch.branchOf).toBe(false)
  })

  it('compacts agent events when saving without mutating the in-memory session', () => {
    const sessions: Session[] = [
      {
        id: 'events',
        title: 'events',
        lastActiveTime: 1,
        messages: [
          {
            id: '100',
            role: 'assistant',
            content: 'hello',
            agentEvents: [
              {
                type: 'agent_message_delta',
                content: 'hel',
                step: 1,
                stepId: 'step-1',
                sequence: 1
              },
              {
                type: 'agent_message_delta',
                content: 'lo',
                step: 1,
                stepId: 'step-1',
                sequence: 2
              },
              {
                type: 'agent_progress',
                step: 1,
                maxSteps: 2,
                stepId: 'step-1',
                activeTools: ['a'],
                sequence: 3
              },
              {
                type: 'agent_progress',
                step: 1,
                maxSteps: 2,
                stepId: 'step-1',
                activeTools: ['b'],
                sequence: 4
              },
              { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'pending' }] },
              { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'completed' }] }
            ]
          }
        ]
      }
    ]

    saveSessions(sessions)

    expect(sessions[0].messages[0].agentEvents).toHaveLength(6)

    closeDb()
    const loaded = loadSessions().find((s) => s.id === 'events')
    const events = loaded?.messages[0].agentEvents

    expect(events).toEqual([
      {
        type: 'agent_message_delta',
        content: 'hello',
        step: 1,
        stepId: 'step-1',
        sequence: 2
      },
      {
        type: 'agent_progress',
        step: 1,
        maxSteps: 2,
        stepId: 'step-1',
        activeTools: ['b'],
        sequence: 4
      },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'completed' }] }
    ])
  })

})
