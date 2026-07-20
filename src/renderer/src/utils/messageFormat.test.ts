import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentEvent } from '../../../shared/types'
import { parseAgentSteps, renderMessageContent } from './messageFormat'

describe('renderMessageContent', () => {
  it('keeps inline math inside the surrounding markdown paragraph', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        renderMessageContent("产生 4 个 $v'_1, v'_2, v'_3, v'_4$，每个 $v'$ 内部还有空间展平。")
      )
    )

    expect(html.match(/<p/g) || []).toHaveLength(1)
    expect(html).toContain('，每个')
    expect(html).toContain('内部还有空间展平。')
  })
})

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
        type: 'reasoning',
        content: 'Final thought. ',
        step: 1,
        stepId: 'run-1:step:1'
      },
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
    expect(run.finalReasoning).toBe('Final thought. ')
    expect(run.steps).toEqual([])
  })

  it('shows the latest unfinished model turn after steering starts another turn', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_message_delta',
        content: 'Draft before background result.',
        step: 2,
        stepId: 'run-1:step:2'
      },
      {
        type: 'agent_message_delta',
        content: 'Updated ',
        step: 3,
        stepId: 'run-1:step:3'
      },
      {
        type: 'agent_message_delta',
        content: 'answer streaming now.',
        step: 3,
        stepId: 'run-1:step:3'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Updated answer streaming now.')
    expect(run.steps).toEqual([])
  })

  it('keeps a committed final answer ahead of older unfinished model turns', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_message_delta',
        content: 'Draft before steering.',
        step: 2,
        stepId: 'run-1:step:2'
      },
      {
        type: 'agent_message_delta',
        content: 'Committed answer.',
        step: 3,
        stepId: 'run-1:step:3'
      },
      {
        type: 'final',
        content: 'Committed answer.',
        step: 3,
        stepId: 'run-1:step:3'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Committed answer.')
  })

  it('keeps reasoning from a forced final answer without attaching it to the last tool step', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_step',
        stepId: 'run-1:step:1',
        step: 1,
        maxSteps: 1,
        title: 'Read files',
        message: 'Read files',
        status: 'running'
      },
      {
        type: 'tool_call',
        callId: 'tc-1',
        toolName: 'read_file',
        args: { path: 'README.md' },
        permissionState: 'approved',
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'tool_result',
        callId: 'tc-1',
        result: { title: 'README.md' },
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'agent_step_end',
        stepId: 'run-1:step:1',
        status: 'completed'
      },
      {
        type: 'reasoning',
        content: 'Summarizing now.'
      },
      {
        type: 'final',
        content: 'Summary.'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Summary.')
    expect(run.finalReasoning).toBe('Summarizing now.')
    expect(run.steps).toHaveLength(1)
    expect(run.steps[0].reasoning).toBe('')
  })

  it('keeps a completed reasoning-only response visible as the final answer', () => {
    const events: AgentEvent[] = [
      { type: 'reasoning', content: 'Hello from the gateway.', step: 1 },
      { type: 'agent_end', status: 'completed' }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.finalAnswer).toBe('Hello from the gateway.')
    expect(run.finalReasoning).toBe('')
    expect(run.steps).toEqual([])
  })

  it('attaches streaming tool output to the matching tool call', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent_step',
        stepId: 'run-1:step:1',
        step: 1,
        maxSteps: 30,
        title: 'Run shell',
        message: 'Running command',
        status: 'running'
      },
      {
        type: 'tool_call',
        callId: 'tc-shell',
        toolName: 'shell',
        args: { command: 'npm test' },
        permissionState: 'approved',
        step: 1,
        stepId: 'run-1:step:1'
      },
      {
        type: 'tool_output_delta',
        callId: 'tc-shell',
        stream: 'stdout',
        content: 'Stdout:\nfirst line',
        replace: true,
        step: 1,
        stepId: 'run-1:step:1'
      }
    ]

    const run = parseAgentSteps(events, '')

    expect(run.steps[0].toolCalls[0].output).toContain('first line')
    expect(run.steps[0].toolCalls[0].status).toBe('running')
  })
})
