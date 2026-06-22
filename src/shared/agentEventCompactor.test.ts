import { describe, expect, it } from 'vitest'

import { AgentEvent } from './types'
import { compactAgentEvents } from './agentEventCompactor'
import { isRuntimeErrorAssistantMessage } from './agentEventReducer'

describe('compactAgentEvents', () => {
  it('coalesces realtime text, reasoning, final, and tool output deltas', () => {
    const events: AgentEvent[] = [
      { type: 'agent_start', skillName: 'General Agent', runId: 'run-1', sequence: 1 },
      { type: 'reasoning', content: 'think ', runId: 'run-1', sequence: 2 },
      { type: 'reasoning', content: 'more', runId: 'run-1', sequence: 3 },
      {
        type: 'agent_message_delta',
        content: 'partial ',
        step: 1,
        stepId: 'step-1',
        sequence: 4
      },
      {
        type: 'agent_message_delta',
        content: 'answer',
        step: 1,
        stepId: 'step-1',
        sequence: 5
      },
      { type: 'tool_output_delta', callId: 'tool-1', stream: 'stdout', content: 'a', sequence: 6 },
      { type: 'tool_output_delta', callId: 'tool-1', stream: 'stdout', content: 'b', sequence: 7 },
      { type: 'final', content: 'done ', sequence: 8 },
      { type: 'final', content: 'now', sequence: 9 }
    ]

    expect(compactAgentEvents(events)).toMatchObject([
      { type: 'agent_start', sequence: 1 },
      { type: 'reasoning', content: 'think more', sequence: 3 },
      { type: 'agent_message_delta', content: 'partial answer', sequence: 5 },
      { type: 'tool_output_delta', content: 'ab', sequence: 7 },
      { type: 'final', content: 'done now', sequence: 9 }
    ])
  })

  it('keeps only the latest progress event per step by default', () => {
    const events: AgentEvent[] = [
      { type: 'agent_progress', step: 1, maxSteps: 3, stepId: 'step-1', activeTools: ['a'], sequence: 1 },
      { type: 'tool_call', callId: 'call-1', toolName: 'a', args: {}, sequence: 2 },
      { type: 'agent_progress', step: 1, maxSteps: 3, stepId: 'step-1', activeTools: ['a', 'b'], sequence: 3 },
      { type: 'agent_progress', step: 2, maxSteps: 3, stepId: 'step-2', activeTools: ['c'], sequence: 4 }
    ]

    expect(compactAgentEvents(events)).toEqual([
      { type: 'tool_call', callId: 'call-1', toolName: 'a', args: {}, sequence: 2 },
      { type: 'agent_progress', step: 1, maxSteps: 3, stepId: 'step-1', activeTools: ['a', 'b'], sequence: 3 },
      { type: 'agent_progress', step: 2, maxSteps: 3, stepId: 'step-2', activeTools: ['c'], sequence: 4 }
    ])
  })

  it('can drop progress events for storage callers that only need durable facts', () => {
    const events: AgentEvent[] = [
      { type: 'agent_start', skillName: 'General Agent' },
      { type: 'agent_progress', step: 1, maxSteps: 1 },
      { type: 'agent_end', status: 'completed' }
    ]

    expect(compactAgentEvents(events, { progress: 'drop' })).toEqual([
      { type: 'agent_start', skillName: 'General Agent' },
      { type: 'agent_end', status: 'completed' }
    ])
  })

  it('keeps the latest task update and latest tool call state', () => {
    const events: AgentEvent[] = [
      { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'pending' }] },
      { type: 'tool_call', callId: 'call-1', toolName: 'shell', args: {}, permissionState: 'pending' },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'completed' }] },
      { type: 'tool_call', callId: 'call-1', toolName: 'shell', args: {}, permissionState: 'approved' }
    ]

    expect(compactAgentEvents(events)).toEqual([
      {
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'shell',
        args: {},
        permissionState: 'approved',
        purpose: undefined
      },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read', status: 'completed' }] }
    ])
  })

  it('preserves interleaved tool output streams instead of reordering them', () => {
    const events: AgentEvent[] = [
      { type: 'tool_output_delta', callId: 'call-1', stream: 'stdout', content: 'out1' },
      { type: 'tool_output_delta', callId: 'call-1', stream: 'stderr', content: 'err' },
      { type: 'tool_output_delta', callId: 'call-1', stream: 'stdout', content: 'out2' }
    ]

    expect(compactAgentEvents(events)).toEqual(events)
  })
})

describe('runtime error prefixes', () => {
  it('recognizes historical and current chat runtime error prefixes', () => {
    expect(
      isRuntimeErrorAssistantMessage({
        id: 'legacy',
        role: 'assistant',
        content: '\u26a0\ufe0f \u51fa\u9519\u4e86\uff1anetwork failed'
      })
    ).toBe(true)
    expect(
      isRuntimeErrorAssistantMessage({
        id: 'current',
        role: 'assistant',
        content: '\u51fa\u9519\u4e86\uff1anetwork failed'
      })
    ).toBe(true)
  })
})
