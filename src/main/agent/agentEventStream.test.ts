import { describe, expect, it, vi } from 'vitest'

import { AgentEvent } from '../../shared/types'
import { createAgentEventStream } from './agentEventStream'

describe('createAgentEventStream', () => {
  it('adds stable run metadata and monotonic sequence numbers', () => {
    const emitted: AgentEvent[] = []
    const now = vi.fn(() => 123456)
    const stream = createAgentEventStream({
      runId: 'run-1',
      now,
      emit: (event) => emitted.push(event)
    })

    const first = stream.emit({ type: 'agent_start', skillName: 'General Agent' })
    const second = stream.emit({ type: 'agent_progress', step: 1, maxSteps: 3 })

    expect(first).toMatchObject({
      type: 'agent_start',
      runId: 'run-1',
      sequence: 1,
      timestamp: 123456
    })
    expect(second).toMatchObject({
      type: 'agent_progress',
      runId: 'run-1',
      sequence: 2,
      timestamp: 123456
    })
    expect(stream.getSequence()).toBe(2)
    expect(emitted).toEqual([first, second])
  })

  it('preserves metadata that was already attached by an upstream stream', () => {
    const emitted: AgentEvent[] = []
    const stream = createAgentEventStream({
      runId: 'run-outer',
      now: () => 2,
      emit: (event) => emitted.push(event)
    })

    stream.emit({
      type: 'agent_end',
      status: 'completed',
      runId: 'run-inner',
      sequence: 99,
      timestamp: 1
    })

    expect(emitted[0]).toMatchObject({
      type: 'agent_end',
      status: 'completed',
      runId: 'run-inner',
      sequence: 99,
      timestamp: 1
    })
    expect(stream.getSequence()).toBe(1)
  })
})
