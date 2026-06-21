import { describe, expect, it, vi } from 'vitest'

import { ActionLog } from './actionLog'
import { AgentRunContext } from './AgentRunContext'
import { startAgentRunLifecycle } from './agentRunLifecycle'

describe('startAgentRunLifecycle', () => {
  it('creates the run context and manifest, then emits end state on finish', () => {
    const controller = new AbortController()
    const runCtx = {
      status: 'running',
      maxSteps: 0,
      completedAt: undefined,
      error: undefined,
      signal: controller.signal
    } as AgentRunContext
    const actionLog = new ActionLog()
    const emitEvent = vi.fn()
    const dependencies = {
      createRun: vi.fn(() => runCtx),
      destroyRun: vi.fn(),
      createRunManifest: vi.fn(),
      finishRunManifest: vi.fn(),
      logRunEnd: vi.fn()
    }

    const lifecycle = startAgentRunLifecycle({
      reqId: 'run-1',
      conversationId: 'conversation-1',
      maxSteps: 7,
      initialActiveTools: ['search_tools'],
      toolScope: 'all',
      actionLog,
      permissions: { shell: 'ask' },
      sessionId: 'session-1',
      projectRoot: 'D:/project',
      projectName: 'project',
      sourceMessageId: 'source-message',
      assistantMessageId: 'assistant-message',
      parentRunId: 'parent-run',
      branchOf: { sessionId: 'source-session', messageId: 'message-1', runId: 'run-0' },
      emitEvent,
      dependencies
    })

    expect(dependencies.createRun).toHaveBeenCalledWith(
      'run-1',
      ['search_tools'],
      'all',
      actionLog,
      { shell: 'ask' },
      'session-1',
      'D:/project',
      'project'
    )
    expect(runCtx.maxSteps).toBe(7)
    expect(lifecycle.runCtx).toBe(runCtx)
    expect(lifecycle.signal).toBe(controller.signal)
    expect(dependencies.createRunManifest).toHaveBeenCalledWith({
      runId: 'run-1',
      sessionId: 'conversation-1',
      sourceMessageId: 'source-message',
      assistantMessageId: 'assistant-message',
      parentRunId: 'parent-run',
      branchOf: { sessionId: 'source-session', messageId: 'message-1', runId: 'run-0' }
    })

    lifecycle.finish('failed', 'boom')

    expect(runCtx.status).toBe('failed')
    expect(runCtx.completedAt).toEqual(expect.any(Number))
    expect(runCtx.error).toBe('boom')
    expect(dependencies.finishRunManifest).toHaveBeenCalledWith(
      'conversation-1',
      'run-1',
      'failed',
      'boom'
    )
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'agent_end',
      status: 'failed',
      error: 'boom'
    })
    expect(dependencies.logRunEnd).toHaveBeenCalledWith('conversation-1', 'failed', 'boom')

    lifecycle.destroy()

    expect(dependencies.destroyRun).toHaveBeenCalledWith('run-1')
  })
})
