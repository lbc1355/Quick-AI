import { describe, expect, it, vi } from 'vitest'
import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { PreparedToolCall } from './toolCallPlanning'
import { runPreparedToolBatch } from './toolBatchRunner'

const makePrep = (overrides: Partial<PreparedToolCall> = {}): PreparedToolCall => ({
  index: 0,
  toolCall: {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'test_tool',
      arguments: '{}'
    }
  },
  toolName: 'test_tool',
  callId: 'call-1',
  args: {},
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification: 'direct',
  ...overrides
})

const makeResponse = (prep: PreparedToolCall, approved: boolean): ChatCompletionMessage => ({
  role: 'tool',
  tool_call_id: prep.callId,
  name: prep.toolName,
  content: approved ? 'approved' : 'denied'
})

describe('runPreparedToolBatch', () => {
  it('requests ask-call permission, emits pending/approved states, and executes sequentially', async () => {
    const events: AgentEvent[] = []
    const ask = makePrep({
      index: 0,
      callId: 'ask-1',
      toolName: 'shell',
      args: { command: 'git status' },
      permission: 'ask',
      classification: 'ask',
      purpose: 'check repo'
    })
    const executeTool = vi.fn(async (prep: PreparedToolCall, approved: boolean) =>
      makeResponse(prep, approved)
    )

    const result = await runPreparedToolBatch({
      toolCallCount: 1,
      askCalls: [ask],
      directCalls: [],
      blockedCalls: [],
      reqId: 'req-1',
      step: 2,
      stepId: 'step-2',
      signal: new AbortController().signal,
      emitEvent: (event) => events.push(event),
      requestPermission: vi.fn(async () => true),
      isToolApproved: () => false,
      isCommandPrefixApproved: () => false,
      executeTool
    })

    expect(executeTool).toHaveBeenCalledWith(ask, true)
    expect(result.toolResponses[0]?.content).toBe('approved')
    expect(events).toEqual([
      {
        type: 'tool_call',
        callId: 'ask-1',
        toolName: 'shell',
        args: { command: 'git status' },
        purpose: 'check repo',
        permissionState: 'pending',
        step: 2,
        stepId: 'step-2'
      },
      {
        type: 'tool_call',
        callId: 'ask-1',
        toolName: 'shell',
        args: { command: 'git status' },
        purpose: 'check repo',
        permissionState: 'approved',
        step: 2,
        stepId: 'step-2'
      }
    ])
  })

  it('returns an error tool response when permission request throws', async () => {
    const events: AgentEvent[] = []
    const ask = makePrep({
      index: 0,
      callId: 'ask-err',
      toolName: 'file_delete',
      permission: 'ask',
      classification: 'ask'
    })
    const executeTool = vi.fn(async (prep: PreparedToolCall, approved: boolean) =>
      makeResponse(prep, approved)
    )

    const result = await runPreparedToolBatch({
      toolCallCount: 1,
      askCalls: [ask],
      directCalls: [],
      blockedCalls: [],
      reqId: 'req-1',
      step: 1,
      stepId: 'step-1',
      signal: new AbortController().signal,
      emitEvent: (event) => events.push(event),
      requestPermission: vi.fn(async () => {
        throw new Error('permission dialog closed')
      }),
      isToolApproved: () => false,
      isCommandPrefixApproved: () => false,
      executeTool
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(result.toolResponses[0]).toEqual({
      role: 'tool',
      tool_call_id: 'ask-err',
      name: 'file_delete',
      content: 'ERROR: permission dialog closed'
    })
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_call', 'tool_error'])
    expect(events[1]).toMatchObject({ type: 'tool_call', permissionState: 'denied' })
    expect(events[2]).toMatchObject({
      type: 'tool_error',
      callId: 'ask-err',
      error: 'permission dialog closed'
    })
  })

  it('executes interactive direct calls before other direct calls and blocked calls', async () => {
    const events: AgentEvent[] = []
    const interactive = makePrep({
      index: 0,
      callId: 'choice',
      toolName: 'ask_user_choice',
      classification: 'direct'
    })
    const direct = makePrep({
      index: 1,
      callId: 'direct',
      toolName: 'file_read',
      classification: 'direct'
    })
    const blocked = makePrep({
      index: 2,
      callId: 'blocked',
      toolName: 'missing_tool',
      classification: 'blocked'
    })
    const callOrder: string[] = []
    const executeTool = vi.fn(async (prep: PreparedToolCall, approved: boolean) => {
      callOrder.push(`${prep.callId}:${approved}`)
      return makeResponse(prep, approved)
    })

    const result = await runPreparedToolBatch({
      toolCallCount: 3,
      askCalls: [],
      directCalls: [direct, interactive],
      blockedCalls: [blocked],
      reqId: 'req-1',
      step: 4,
      stepId: 'step-4',
      signal: new AbortController().signal,
      emitEvent: (event) => events.push(event),
      requestPermission: vi.fn(),
      isToolApproved: () => false,
      isCommandPrefixApproved: () => false,
      executeTool
    })

    expect(callOrder[0]).toBe('choice:true')
    expect(callOrder).toContain('direct:true')
    expect(callOrder).toContain('blocked:false')
    expect(result.toolResponses.map((response) => response?.tool_call_id)).toEqual([
      'choice',
      'direct',
      'blocked'
    ])
    expect(
      events.filter((event) => event.type === 'tool_call').map((event) => event.callId)
    ).toEqual(['choice', 'direct'])
  })
})
