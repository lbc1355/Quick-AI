import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import {
  copyAgentEventJournalsForRuns,
  createAgentEventJournalWriter,
  deleteAgentEventJournal,
  deleteAgentEventJournals,
  getAgentEventJournalDir,
  loadAgentEventJournal,
  recoverInterruptedAgentEventJournals
} from './agentEventJournal'

const testDir = join(__dirname, '../../../temp-agent-event-journal-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

describe('agentEventJournal', () => {
  beforeEach(async () => {
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('persists compacted events with run metadata and redacts secrets', () => {
    const writer = createAgentEventJournalWriter({
      sessionId: 'session-1',
      runId: 'run-1',
      sourceMessageId: 'user-1',
      assistantMessageId: 'assistant-1'
    })
    writer.append({
      type: 'agent_start',
      skillName: 'General Agent',
      runId: 'run-1',
      sequence: 1,
      timestamp: 10
    })
    writer.append({
      type: 'reasoning',
      content: 'inspect ',
      runId: 'run-1',
      sequence: 2,
      timestamp: 11
    })
    writer.append({
      type: 'reasoning',
      content: 'files',
      runId: 'run-1',
      sequence: 3,
      timestamp: 12
    })
    writer.append({
      type: 'tool_call',
      callId: 'call-1',
      toolName: 'shell',
      args: { apiKey: 'secret-key', nested: { authorization: 'Bearer secret' } },
      runId: 'run-1',
      sequence: 4,
      timestamp: 13
    })
    writer.flush()

    const journal = loadAgentEventJournal('session-1', 'run-1')
    expect(journal).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      lastSequence: 4
    })
    expect(journal?.events).toMatchObject([
      { type: 'agent_start', sequence: 1 },
      { type: 'reasoning', content: 'inspect files', sequence: 3 },
      {
        type: 'tool_call',
        args: { apiKey: '[REDACTED]', nested: { authorization: '[REDACTED]' } },
        sequence: 4
      }
    ])
    expect(JSON.stringify(journal)).not.toContain('secret-key')
    expect(JSON.stringify(journal)).not.toContain('Bearer secret')
  })

  it('flushes a terminal event immediately', () => {
    const writer = createAgentEventJournalWriter({ sessionId: 'session-1', runId: 'run-1' })
    writer.append({ type: 'agent_start', skillName: 'General Agent', sequence: 1 })
    writer.append({ type: 'final', content: 'done', sequence: 2 })
    writer.append({ type: 'agent_end', status: 'completed', sequence: 3 })

    expect(loadAgentEventJournal('session-1', 'run-1')).toMatchObject({
      status: 'completed',
      lastSequence: 3,
      events: [
        expect.objectContaining({ type: 'agent_start' }),
        expect.objectContaining({ type: 'final', content: 'done' }),
        expect.objectContaining({ type: 'agent_end', status: 'completed' })
      ]
    })
  })

  it('bounds oversized event payloads before writing them', () => {
    const writer = createAgentEventJournalWriter({ sessionId: 'session-1', runId: 'run-large' })
    const args = Object.fromEntries(
      Array.from({ length: 220 }, (_, index) => [`field-${index}`, 'x'.repeat(2_000)])
    )
    writer.append({
      type: 'tool_call',
      callId: 'large-call',
      toolName: 'shell',
      args,
      sequence: 1
    })
    writer.flush()

    const journal = loadAgentEventJournal('session-1', 'run-large')
    expect(journal?.events[0]).toMatchObject({
      type: 'tool_call',
      callId: 'large-call',
      args: { __truncated__: 'Oversized tool arguments' }
    })
    expect(JSON.stringify(journal).length).toBeLessThan(300_000)
  })

  it('marks a running journal as interrupted and appends a resumable failed end event', () => {
    const writer = createAgentEventJournalWriter({
      sessionId: 'session-1',
      runId: 'run-1',
      assistantMessageId: 'assistant-1'
    })
    writer.append({ type: 'agent_start', skillName: 'General Agent', sequence: 1 })
    writer.append({
      type: 'tool_call',
      callId: 'call-1',
      toolName: 'file_read',
      args: {},
      sequence: 2
    })
    writer.close()

    const recovered = recoverInterruptedAgentEventJournals()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      status: 'interrupted',
      lastSequence: 3,
      completedAt: expect.any(Number)
    })
    expect(recovered[0].events.at(-1)).toMatchObject({
      type: 'agent_end',
      status: 'failed',
      runId: 'run-1',
      sequence: 3,
      error: expect.stringContaining('interrupted')
    })
    expect(recoverInterruptedAgentEventJournals()).toEqual([])
  })

  it('copies and deletes journals with their session cache lifecycle', async () => {
    const writer = createAgentEventJournalWriter({ sessionId: 'source', runId: 'run-1' })
    writer.append({ type: 'agent_start', skillName: 'General Agent', sequence: 1 })
    writer.append({ type: 'agent_end', status: 'completed', sequence: 2 })

    expect(copyAgentEventJournalsForRuns('source', 'target', ['run-1'])).toBe(1)
    expect(loadAgentEventJournal('target', 'run-1')).toMatchObject({
      sessionId: 'target',
      runId: 'run-1',
      status: 'completed'
    })

    await deleteAgentEventJournal('target', 'run-1')
    expect(loadAgentEventJournal('target', 'run-1')).toBeUndefined()
    await deleteAgentEventJournals('source')
    expect(existsSync(getAgentEventJournalDir('source'))).toBe(false)
  })
})
