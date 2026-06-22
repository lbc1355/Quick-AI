import { describe, expect, it } from 'vitest'

import { AgentEvent } from './types'
import { compactAgentEvents } from './agentEventCompactor'
import { replayAgentEvents } from './agentEventReplay'

describe('replayAgentEvents', () => {
  it('replays compacted streaming events into durable message state', () => {
    const realtimeEvents: AgentEvent[] = [
      { type: 'agent_start', skillName: 'General Agent', runId: 'run-1', sequence: 1 },
      { type: 'reasoning', content: 'inspect ', runId: 'run-1', sequence: 2 },
      { type: 'reasoning', content: 'files', runId: 'run-1', sequence: 3 },
      { type: 'agent_message_delta', content: 'working ', step: 1, stepId: 'step-1', sequence: 4 },
      { type: 'agent_message_delta', content: 'draft', step: 1, stepId: 'step-1', sequence: 5 },
      { type: 'tool_output_delta', callId: 'shell-1', stream: 'stdout', content: 'line 1', sequence: 6 },
      { type: 'tool_output_delta', callId: 'shell-1', stream: 'stdout', content: '\nline 2', sequence: 7 },
      { type: 'final', content: 'Final ', sequence: 8 },
      { type: 'final', content: 'answer', sequence: 9 },
      { type: 'agent_end', status: 'completed', sequence: 10 }
    ]

    const compacted = compactAgentEvents(realtimeEvents)
    const replayed = replayAgentEvents(compacted, {
      message: { id: 'assistant-1', agentRunId: 'run-1' }
    })

    expect(replayed).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      agentRunId: 'run-1',
      content: 'Final answer',
      reasoning_content: 'inspect files'
    })
    expect(replayed.agentEvents).toMatchObject([
      { type: 'agent_start', sequence: 1 },
      { type: 'reasoning', content: 'inspect files', sequence: 3 },
      { type: 'agent_message_delta', content: 'working draft', sequence: 5 },
      { type: 'tool_output_delta', content: 'line 1\nline 2', sequence: 7 },
      { type: 'final', content: 'Final answer', sequence: 9 },
      { type: 'agent_end', status: 'completed', sequence: 10 }
    ])
  })

  it('replays compacted tool state and task updates', () => {
    const compacted = compactAgentEvents([
      { type: 'tool_call', callId: 'call-1', toolName: 'file_read', args: {}, permissionState: 'pending', sequence: 1 },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read file', status: 'pending' }], sequence: 2 },
      { type: 'tool_call', callId: 'call-1', toolName: 'file_read', args: {}, permissionState: 'approved', sequence: 3 },
      {
        type: 'tool_result',
        callId: 'call-1',
        result: { title: 'Read File', summary: 'Loaded src/main.ts' },
        sequence: 4
      },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read file', status: 'completed' }], sequence: 5 },
      { type: 'agent_end', status: 'completed', sequence: 6 }
    ])

    const replayed = replayAgentEvents(compacted)

    expect(replayed.content).toBe('')
    expect(replayed.reasoning_content).toBeUndefined()
    expect(replayed.agentEvents).toEqual([
      {
        type: 'tool_call',
        callId: 'call-1',
        toolName: 'file_read',
        args: {},
        permissionState: 'approved',
        sequence: 3,
        purpose: undefined
      },
      {
        type: 'tool_result',
        callId: 'call-1',
        result: { title: 'Read File', summary: 'Loaded src/main.ts' },
        sequence: 4
      },
      { type: 'task_update', tasks: [{ id: '1', title: 'Read file', status: 'completed' }], sequence: 5 },
      { type: 'agent_end', status: 'completed', sequence: 6 }
    ])
  })

  it('preserves base message metadata while replaying events', () => {
    const replayed = replayAgentEvents([{ type: 'final', content: 'ok' }], {
      message: {
        id: 'm1',
        agentRunId: 'run-1',
        agentRunIds: ['run-0', 'run-1'],
        tokenSpeed: 12.5
      }
    })

    expect(replayed.id).toBe('m1')
    expect(replayed.agentRunId).toBe('run-1')
    expect(replayed.agentRunIds).toEqual(['run-0', 'run-1'])
    expect(replayed.tokenSpeed).toBe(12.5)
    expect(replayed.content).toBe('ok')
  })
})
