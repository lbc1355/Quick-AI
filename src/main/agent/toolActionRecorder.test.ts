import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLog } from './actionLog'
import { recordToolAction } from './toolActionRecorder'

const runManifestMocks = vi.hoisted(() => ({
  appendRunAction: vi.fn(),
  updateRunManifest: vi.fn()
}))

const sessionLoggerMocks = vi.hoisted(() => ({
  logToolExecution: vi.fn()
}))

vi.mock('./runManifest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runManifest')>()),
  appendRunAction: runManifestMocks.appendRunAction,
  updateRunManifest: runManifestMocks.updateRunManifest
}))

vi.mock('./sessionLogger', () => ({
  SessionLogger: sessionLoggerMocks
}))

describe('recordToolAction', () => {
  beforeEach(() => {
    runManifestMocks.appendRunAction.mockReset()
    runManifestMocks.updateRunManifest.mockReset()
    sessionLoggerMocks.logToolExecution.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T10:00:00.000Z'))
  })

  it('records an action log entry, run manifest side effect, and debug log entry', () => {
    const actionLog = new ActionLog()

    const result = recordToolAction({
      actionLog,
      conversationId: 'session-1',
      reqId: 'run-1',
      turnIndex: 3,
      callId: 'call-1',
      toolName: 'shell',
      args: { command: 'git status' },
      permission: 'ask',
      status: 'success',
      resultContent: 'x'.repeat(120),
      outputSpilloverThreshold: 100,
      startedAt: Date.now() - 42
    })

    const record = actionLog.get('call-1')
    expect(record).toMatchObject({
      callId: 'call-1',
      reqId: 'run-1',
      turnIndex: 3,
      toolName: 'shell',
      args: { command: 'git status' },
      resultStatus: 'success',
      resultSize: 120,
      resultInOutputStore: true,
      permission: 'ask',
      durationMs: 42
    })
    expect(record?.resultSummary).toHaveLength(120)

    expect(runManifestMocks.appendRunAction).toHaveBeenCalledWith(
      'session-1',
      'run-1',
      'call-1',
      expect.objectContaining({
        actionId: 'call-1',
        runId: 'run-1',
        toolName: 'shell',
        kind: 'shell',
        status: 'success',
        summary: 'x'.repeat(120)
      })
    )
    expect(sessionLoggerMocks.logToolExecution).toHaveBeenCalledWith(
      'session-1',
      'call-1',
      'shell',
      { command: 'git status' },
      'ask',
      'success',
      42,
      'x'.repeat(120)
    )
    expect(result.durationMs).toBe(42)
  })

  it('updates run manifest resource ids without duplicating existing entries', () => {
    const actionLog = new ActionLog()
    const content =
      'Fetched content\nResource ID: abcdef1234567890\nResource ID: abcdef1234567890\nResource ID: resource_extra_12345'

    const result = recordToolAction({
      actionLog,
      conversationId: 'session-2',
      reqId: 'run-2',
      turnIndex: 1,
      callId: 'call-2',
      toolName: 'fetch_url',
      args: { url: 'https://example.com' },
      permission: 'allow',
      status: 'success',
      resultContent: content,
      outputSpilloverThreshold: 1000,
      startedAt: Date.now()
    })

    expect(result.resourceIds).toEqual(['abcdef1234567890', 'resource_extra_12345'])
    expect(runManifestMocks.updateRunManifest).toHaveBeenCalledTimes(1)

    const updater = runManifestMocks.updateRunManifest.mock.calls[0][2]
    const manifest = updater({
      resourceIds: ['abcdef1234567890', 'existing-resource']
    })
    expect(manifest.resourceIds).toEqual([
      'abcdef1234567890',
      'existing-resource',
      'resource_extra_12345'
    ])
  })

  it('uses UTF-8 bytes for the output-store threshold while preserving character size metadata', () => {
    const actionLog = new ActionLog()

    recordToolAction({
      actionLog,
      conversationId: 'session-utf8',
      reqId: 'run-utf8',
      turnIndex: 1,
      callId: 'call-utf8',
      toolName: 'shell',
      args: {},
      permission: 'allow',
      status: 'success',
      resultContent: '中文',
      outputSpilloverThreshold: 4,
      startedAt: Date.now()
    })

    expect(actionLog.get('call-utf8')).toMatchObject({
      resultSize: 2,
      resultInOutputStore: true
    })
  })
})
