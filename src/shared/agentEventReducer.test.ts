import { describe, expect, it } from 'vitest'

import { AgentEvent, Message } from './types'
import {
  applyAgentEventToMessage,
  isRuntimeErrorAssistantMessage,
  mergeAgentEvents,
  prepareMessageForInlineResume
} from './agentEventReducer'

describe('mergeAgentEvents', () => {
  it('updates repeated tool_call events in place and preserves the original purpose', () => {
    const events = mergeAgentEvents(
      [
        {
          type: 'tool_call',
          callId: 'call-1',
          toolName: 'shell',
          args: { command: 'git status' },
          purpose: 'Check status',
          permissionState: 'pending',
          runId: 'run-1',
          sequence: 1,
          timestamp: 10
        }
      ],
      {
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'shell',
        args: { command: 'git status' },
        permissionState: 'approved',
        runId: 'run-1',
        sequence: 2,
        timestamp: 20
      }
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      callId: 'call-1',
      permissionState: 'approved',
      purpose: 'Check status',
      sequence: 2,
      timestamp: 20
    })
  })

  it('coalesces adjacent tool output deltas for the same stream', () => {
    const events = mergeAgentEvents(
      [
        {
          type: 'tool_output_delta',
          callId: 'call-1',
          stream: 'stdout',
          content: 'line 1',
          sequence: 1
        }
      ],
      {
        type: 'tool_output_delta',
        callId: 'call-1',
        stream: 'stdout',
        content: '\nline 2',
        sequence: 2,
        timestamp: 30
      }
    )

    expect(events).toEqual([
      {
        type: 'tool_output_delta',
        callId: 'call-1',
        stream: 'stdout',
        content: 'line 1\nline 2',
        sequence: 2,
        timestamp: 30,
        replace: undefined,
        runId: undefined
      }
    ])
  })

  it('replaces older task updates with the latest task list', () => {
    const events = mergeAgentEvents(
      [
        { type: 'agent_start', skillName: 'General Agent' },
        { type: 'task_update', tasks: [{ id: '1', title: 'Old', status: 'pending' }] }
      ],
      { type: 'task_update', tasks: [{ id: '1', title: 'Old', status: 'completed' }] }
    )

    expect(events).toEqual([
      { type: 'agent_start', skillName: 'General Agent' },
      { type: 'task_update', tasks: [{ id: '1', title: 'Old', status: 'completed' }] }
    ])
  })

  it('deduplicates background subagent completion events', () => {
    const first = mergeAgentEvents([], {
      type: 'subagent_end',
      subagentId: 'subagent-1',
      status: 'completed',
      finalAnswer: 'first'
    })
    const updated = mergeAgentEvents(first, {
      type: 'subagent_end',
      subagentId: 'subagent-1',
      status: 'completed',
      finalAnswer: 'latest'
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ type: 'subagent_end', finalAnswer: 'latest' })
  })

  it('keeps start before completion when a fast background result arrives first', () => {
    const completed = mergeAgentEvents([], {
      type: 'subagent_end',
      subagentId: 'subagent-fast',
      status: 'completed'
    })
    const ordered = mergeAgentEvents(completed, {
      type: 'subagent_start',
      subagentId: 'subagent-fast',
      parentToolCallId: 'call-fast',
      label: 'Research',
      task: 'Inspect',
      maxSteps: 4
    })

    expect(ordered.map((event) => event.type)).toEqual(['subagent_start', 'subagent_end'])
  })

  it('coalesces adjacent subagent message deltas for the same inner step', () => {
    const first = mergeAgentEvents([], {
      type: 'subagent_event',
      subagentId: 'subagent-1',
      sequence: 1,
      event: {
        type: 'agent_message_delta',
        content: 'Inspection ',
        step: 1,
        stepId: 'subagent-1:step:1',
        sequence: 10
      }
    })
    const merged = mergeAgentEvents(first, {
      type: 'subagent_event',
      subagentId: 'subagent-1',
      sequence: 2,
      timestamp: 30,
      event: {
        type: 'agent_message_delta',
        content: 'complete',
        step: 1,
        stepId: 'subagent-1:step:1',
        sequence: 11,
        timestamp: 25
      }
    })

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      type: 'subagent_event',
      subagentId: 'subagent-1',
      sequence: 2,
      timestamp: 30,
      event: {
        type: 'agent_message_delta',
        content: 'Inspection complete',
        sequence: 11,
        timestamp: 25
      }
    })
  })

  it('keeps subagent deltas separate across inner steps', () => {
    const first = mergeAgentEvents([], {
      type: 'subagent_event',
      subagentId: 'subagent-1',
      event: {
        type: 'agent_message_delta',
        content: 'Step one',
        step: 1,
        stepId: 'subagent-1:step:1'
      }
    })
    const separated = mergeAgentEvents(first, {
      type: 'subagent_event',
      subagentId: 'subagent-1',
      event: {
        type: 'agent_message_delta',
        content: 'Step two',
        step: 2,
        stepId: 'subagent-1:step:2'
      }
    })

    expect(separated).toHaveLength(2)
  })
})

describe('applyAgentEventToMessage', () => {
  it('updates visible content and coalesces final events', () => {
    const message: Message = { id: 'm1', role: 'assistant', content: '' }

    const afterFirst = applyAgentEventToMessage(message, {
      type: 'final',
      content: 'Hello ',
      sequence: 1
    })
    const afterSecond = applyAgentEventToMessage(afterFirst, {
      type: 'final',
      content: 'world',
      sequence: 2
    })

    expect(afterSecond.content).toBe('Hello world')
    expect(afterSecond.agentEvents).toMatchObject([
      { type: 'final', content: 'Hello world', sequence: 2 }
    ])
  })

  it('updates reasoning content while keeping assistant content untouched', () => {
    const message: Message = { id: 'm1', role: 'assistant', content: 'answer' }
    const updated = applyAgentEventToMessage(message, { type: 'reasoning', content: 'thinking' })

    expect(updated.content).toBe('answer')
    expect(updated.reasoning_content).toBe('thinking')
    expect(updated.agentEvents).toEqual([{ type: 'reasoning', content: 'thinking' }])
  })
})

describe('isRuntimeErrorAssistantMessage', () => {
  it('recognizes chat runtime error prefixes', () => {
    expect(
      isRuntimeErrorAssistantMessage({
        id: 'm1',
        role: 'assistant',
        content: '\u51fa\u9519\u4e86\uff1a\u7f51\u7edc\u8fde\u63a5\u5931\u8d25'
      })
    ).toBe(true)
    expect(
      isRuntimeErrorAssistantMessage({
        id: 'm2',
        role: 'assistant',
        content: '\u26a0\ufe0f \u51fa\u9519\u4e86\uff1a\u7f51\u7edc\u8fde\u63a5\u5931\u8d25'
      })
    ).toBe(true)
  })
})

describe('prepareMessageForInlineResume', () => {
  it('drops failed terminal events but preserves earlier run events', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Agent resume failed: API unavailable',
      agentRunId: 'run-1',
      isRuntimeError: true,
      agentEvents: [
        { type: 'agent_start', skillName: 'General Agent' },
        { type: 'tool_call', callId: 'call-1', toolName: 'file_read', args: {} },
        { type: 'agent_end', status: 'failed', error: 'API unavailable' },
        { type: 'final', content: 'Agent resume failed: API unavailable' }
      ] as AgentEvent[]
    }

    const prepared = prepareMessageForInlineResume(message, 'run-2')

    expect(prepared.agentRunId).toBe('run-2')
    expect(prepared.agentRunIds).toEqual(['run-1', 'run-2'])
    expect(prepared.agentEvents).toEqual([
      { type: 'agent_start', skillName: 'General Agent' },
      { type: 'tool_call', callId: 'call-1', toolName: 'file_read', args: {} }
    ])
  })
})
