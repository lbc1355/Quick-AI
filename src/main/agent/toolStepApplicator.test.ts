import { describe, expect, it, vi } from 'vitest'
import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { ToolDefinition } from '../tools/types'
import { materializeToolRegistry, ToolRegistryView } from '../tools/registryView'
import { createToolStepExecutor } from './toolStepApplicator'
import { PreparedToolCall } from './toolCallPlanning'

const makePrep = (overrides: Partial<PreparedToolCall> = {}): PreparedToolCall => ({
  index: 1,
  toolCall: {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'file_read',
      arguments: '{}'
    }
  },
  toolName: 'file_read',
  callId: 'call-1',
  args: { path: 'README.md' },
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification: 'direct',
  ...overrides
})

const makeTool = (): ToolDefinition => ({
  name: 'file_read',
  title: 'Read File',
  description: 'Read file',
  tags: [],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: vi.fn()
})

const registryOf = (tools: Record<string, ToolDefinition | undefined>): ToolRegistryView => ({
  get: (name) => tools[name],
  list: () => Object.values(tools).filter((tool): tool is ToolDefinition => !!tool)
})

describe('createToolStepExecutor', () => {
  it('executes a prepared call and applies runtime side effects in one place', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T10:00:00.000Z'))

    const prep = makePrep()
    const tool = makeTool()
    const emittedEvents: AgentEvent[][] = []
    const toolModelAttachments = []
    const ambiguousAction = {
      callId: 'call-1',
      toolName: 'file_read',
      args: { path: 'README.md' },
      reason: 'ambiguous result',
      timestamp: 123
    }
    const response: ChatCompletionMessage = {
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'file_read',
      content: 'runtime output'
    }
    const executePreparedToolCall = vi.fn(async () => ({
      response,
      events: [
        {
          type: 'tool_result' as const,
          callId: 'call-1',
          result: { title: 'Read File', summary: 'ok' }
        }
      ],
      action: {
        resultStatus: 'success' as const,
        resultContent: 'runtime output'
      },
      haltRequested: true,
      modelAttachments: [
        {
          type: 'image_url' as const,
          image_url: { url: 'data:image/png;base64,abc' }
        }
      ],
      markExecutedCallKey: 'fetch_url:https://example.com:mode=static:offset=0:maxChars=default',
      outputStore: {
        callId: 'call-1',
        content: 'full output',
        activateToolName: 'read_tool_output' as const
      },
      ambiguousAction
    }))
    const markExecuted = vi.fn()
    const storeToolOutput = vi.fn()
    const activateTool = vi.fn()
    const onHaltRequested = vi.fn()
    const onAmbiguousAction = vi.fn()
    const recordToolAction = vi.fn()

    const executeTool = createToolStepExecutor({
      toolRegistry: registryOf({ file_read: tool }),
      reqId: 'req-1',
      conversationId: 'session-1',
      step: 3,
      maxSteps: 8,
      stepId: 'step-3',
      signal: new AbortController().signal,
      retryPolicy: {
        maxRetries: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
        retryableErrors: new Set<string>()
      },
      isSideEffecting: () => false,
      loopGuard: {
        recordSuccess: vi.fn(),
        recordFailure: vi.fn()
      },
      outputSpilloverThreshold: 100,
      activeTools: new Set(['file_read']),
      fetchUrlBudget: { count: 0, max: 10 },
      toolModelAttachments,
      actionLog: {} as never,
      markExecuted,
      storeToolOutput,
      activateTool,
      onHaltRequested,
      onAmbiguousAction,
      executePreparedToolCall,
      recordToolAction,
      emitEvent: vi.fn()
    })

    const result = await executeTool(prep, true, (events) => emittedEvents.push(events))

    expect(result).toBe(response)
    expect(executePreparedToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        prep,
        tool,
        isApproved: true,
        reqId: 'req-1',
        step: 3,
        maxSteps: 8,
        stepId: 'step-3',
        outputSpilloverThreshold: 100,
        activeTools: ['file_read']
      })
    )
    expect(toolModelAttachments[1]).toHaveLength(1)
    expect(markExecuted).toHaveBeenCalledWith(
      'fetch_url:https://example.com:mode=static:offset=0:maxChars=default'
    )
    expect(storeToolOutput).toHaveBeenCalledWith('call-1', 'full output')
    expect(activateTool).toHaveBeenCalledWith('read_tool_output')
    expect(emittedEvents).toEqual([
      [
        {
          type: 'tool_result',
          callId: 'call-1',
          result: { title: 'Read File', summary: 'ok' }
        }
      ]
    ])
    expect(onHaltRequested).toHaveBeenCalledTimes(1)
    expect(onAmbiguousAction).toHaveBeenCalledWith(ambiguousAction)
    expect(recordToolAction).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'session-1',
        reqId: 'req-1',
        turnIndex: 3,
        callId: 'call-1',
        toolName: 'file_read',
        args: { path: 'README.md' },
        permission: 'allow',
        status: 'success',
        resultContent: 'runtime output',
        outputSpilloverThreshold: 100,
        startedAt: Date.now()
      })
    )
  })

  it('blocks a tool definition replaced after the model turn snapshot', async () => {
    const advertisedTool = makeTool()
    const liveTools: Record<string, ToolDefinition | undefined> = {
      file_read: advertisedTool
    }
    const snapshot = materializeToolRegistry(registryOf(liveTools))
    const replacementTool = makeTool()
    liveTools.file_read = replacementTool

    const response: ChatCompletionMessage = {
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'file_read',
      content: 'blocked stale call'
    }
    const executePreparedToolCall = vi.fn(async () => ({
      response,
      events: [],
      action: {
        resultStatus: 'blocked' as const,
        resultContent: 'blocked stale call'
      },
      haltRequested: false
    }))
    const executeTool = createToolStepExecutor({
      toolRegistry: snapshot,
      reqId: 'req-1',
      conversationId: 'session-1',
      step: 1,
      maxSteps: 8,
      stepId: 'step-1',
      signal: new AbortController().signal,
      retryPolicy: {
        maxRetries: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
        retryableErrors: new Set<string>()
      },
      isSideEffecting: () => false,
      loopGuard: {
        recordSuccess: vi.fn(),
        recordFailure: vi.fn()
      },
      outputSpilloverThreshold: 100,
      activeTools: new Set(['file_read']),
      fetchUrlBudget: { count: 0, max: 10 },
      toolModelAttachments: [],
      actionLog: {} as never,
      markExecuted: vi.fn(),
      storeToolOutput: vi.fn(),
      activateTool: vi.fn(),
      onHaltRequested: vi.fn(),
      onAmbiguousAction: vi.fn(),
      executePreparedToolCall,
      recordToolAction: vi.fn()
    })

    await expect(executeTool(makePrep(), true, vi.fn())).resolves.toBe(response)
    expect(executePreparedToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        prep: expect.objectContaining({
          isValid: false,
          blockReason: expect.stringContaining('Stale tool call: file_read')
        }),
        tool: undefined
      })
    )
    expect(advertisedTool.execute).not.toHaveBeenCalled()
    expect(replacementTool.execute).not.toHaveBeenCalled()
  })
})
