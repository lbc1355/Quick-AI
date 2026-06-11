import { describe, expect, it } from 'vitest'
import { AgentEvent } from '../../../shared/types'
import { parseAgentSteps } from './messageFormat'

describe('parseAgentSteps agent_message_delta', () => {
  it('shows unclassified model deltas as the pending answer', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_message_delta',
        content: 'Final ',
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'agent_message_delta',
        content: 'answer.',
        step: 1,
        stepId: 'run-1:step:1'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Final answer.')
    expect(run.steps).toEqual([])
  })

  it('reclassifies model deltas as step progress once an agent step is confirmed', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_message_delta',
        content: 'I will inspect the files.',
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'agent_step',
        stepId: 'run-1:step:1',
        step: 1,
        maxSteps: 30,
        title: 'Inspect files',
        message: 'I will inspect the files.',
        status: 'running'
      },
      {
        type: 'tool_call',
        callId: 'tc-1',
        toolName: 'read_file',
        args: { path: 'src/main.ts' },
        permissionState: 'approved',
        step: 1,
        stepId: 'run-1:step:1'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('')
    expect(run.steps).toHaveLength(1)
    expect(run.steps[0].progressMessage).toBe('I will inspect the files.')
    expect(run.steps[0].toolCalls).toHaveLength(1)
  })

  it('keeps only the committed final answer after final classification', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_message_delta',
        content: 'Final answer.',
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'final',
        content: 'Final answer.',
        step: 1,
        stepId: 'run-1:step:1'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Final answer.')
    expect(run.steps).toEqual([])
  })
})
