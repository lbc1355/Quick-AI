import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { ActionLog } from './actionLog'
import { LoopGuard } from './loopGuard'
import { DEFAULT_RETRY_POLICY } from './retryPolicy'
import { runToolTurn, ToolTurnRunContext } from './toolTurnRunner'
import { PreparedToolCall, prepareToolCalls as realPrepareToolCalls } from './toolCallPlanning'
import { ToolRegistryView } from '../tools/registryView'

const rawToolCall = (
  id: string,
  name: string
): NonNullable<ChatCompletionMessage['tool_calls']>[number] => ({
  id,
  type: 'function',
  function: {
    name,
    arguments: '{}'
  }
})

const prepared = (
  index: number,
  toolName: string,
  classification: PreparedToolCall['classification']
): PreparedToolCall => ({
  index,
  toolCall: rawToolCall(`call-${index}`, toolName),
  toolName,
  callId: `call-${index}`,
  args: {},
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification
})

const emptyToolRegistry: ToolRegistryView = {
  get: () => undefined,
  list: () => []
}

describe('runToolTurn', () => {
  it('prepares, presents, processes, and returns a completed tool turn', async () => {
    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: 'I will inspect files.',
      tool_calls: [rawToolCall('call-0', 'file_read'), rawToolCall('call-1', 'shell')]
    }
    const direct = prepared(0, 'file_read', 'direct')
    const ask = prepared(1, 'shell', 'ask')
    const toolMessage: ChatCompletionMessage = {
      role: 'tool',
      tool_call_id: 'call-0',
      content: 'tool result'
    }
    const runContext: ToolTurnRunContext = {
      activeTools: new Set(['file_read']),
      actionLog: new ActionLog(),
      projectRoot: 'D:/project',
      isToolActive: vi.fn((toolName) => toolName === 'file_read'),
      isToolApproved: vi.fn((toolName) => toolName === 'shell'),
      isCommandPrefixApproved: vi.fn((command) => command === 'git status'),
      hasExecuted: vi.fn((callKey) => callKey === 'fetch_url:https://cached'),
      markExecuted: vi.fn(),
      storeToolOutput: vi.fn(),
      activateTool: vi.fn()
    }
    const ambiguousAction = {
      callId: 'call-1',
      toolName: 'shell',
      args: { command: 'npm install' },
      reason: 'interrupted',
      timestamp: 1
    }
    const prepareToolCalls = vi.fn<typeof realPrepareToolCalls>(() => ({
      prepared: [direct, ask],
      askCalls: [ask],
      directCalls: [direct],
      blockedCalls: []
    }))
    const buildAgentStepPresentation = vi.fn(() => ({
      title: 'Inspect files',
      message: 'I will inspect files.'
    }))
    const createToolStepExecutor = vi.fn((options) => {
      options.onHaltRequested()
      options.onAmbiguousAction(ambiguousAction)
      return vi.fn()
    })
    const processPreparedToolStep = vi.fn(async () => ({
      messagesToAppend: [toolMessage],
      lastRecordedCallId: 'call-0',
      status: 'completed' as const
    }))
    const emitEvent = vi.fn()
    const requestPermission = vi.fn(async () => true)

    const result = await runToolTurn({
      assistantMessage,
      assistantTextBuffer: '',
      toolDiscovery: 'dynamic',
      skillTools: [],
      permissions: { shell: 'ask' },
      reqId: 'req-1',
      conversationId: 'session-1',
      step: 2,
      maxSteps: 5,
      stepId: 'req-1:step:2',
      signal: new AbortController().signal,
      resources: [],
      retryPolicy: DEFAULT_RETRY_POLICY,
      isSideEffecting: () => false,
      loopGuard: new LoopGuard(),
      outputSpilloverThreshold: 1000,
      fetchUrlBudget: { count: 0, max: 10 },
      toolRegistry: emptyToolRegistry,
      runContext,
      emitEvent,
      requestPermission,
      dependencies: {
        prepareToolCalls,
        buildAgentStepPresentation,
        createToolStepExecutor,
        processPreparedToolStep
      }
    })

    const prepareInput = prepareToolCalls.mock.calls[0]![0] as Parameters<
      typeof realPrepareToolCalls
    >[0]
    expect(prepareInput.toolCalls).toBe(assistantMessage.tool_calls)
    expect(prepareInput.isToolWhitelisted('file_read')).toBe(true)
    expect(prepareInput.isToolWhitelisted('shell')).toBe(false)
    expect(prepareInput.isToolApproved('shell')).toBe(true)
    expect(prepareInput.isCommandPrefixApproved('git status')).toBe(true)
    expect(prepareInput.hasExecuted('fetch_url:https://cached')).toBe(true)
    expect(prepareInput.projectRoot).toBe('D:/project')

    expect(buildAgentStepPresentation).toHaveBeenCalledWith('I will inspect files.', [direct, ask])
    expect(createToolStepExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        reqId: 'req-1',
        conversationId: 'session-1',
        step: 2,
        maxSteps: 5,
        stepId: 'req-1:step:2',
        activeTools: runContext.activeTools,
        actionLog: runContext.actionLog
      })
    )
    expect(processPreparedToolStep).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallCount: 2,
        preparedCalls: [direct, ask],
        askCalls: [ask],
        directCalls: [direct],
        blockedCalls: [],
        title: 'Inspect files',
        message: 'I will inspect files.',
        emitEvent,
        requestPermission
      })
    )
    expect(result).toEqual({
      messagesToAppend: [toolMessage],
      lastRecordedCallId: 'call-0',
      haltRequested: true,
      ambiguousActions: [ambiguousAction]
    })
  })
})
