import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SubagentRunState } from './SubagentRunCard'
import { SubagentRunPanel } from './SubagentRunPanel'

const makeSubagent = (status: SubagentRunState['status']): SubagentRunState => ({
  info: {
    type: 'subagent_start',
    subagentId: 'subagent-1',
    parentToolCallId: 'call-1',
    label: 'Research',
    task: 'Inspect streaming behavior',
    maxSteps: 4
  },
  events: [
    {
      type: 'agent_message_delta',
      content: '**streaming answer**',
      step: 1,
      stepId: 'subagent-1:step:1'
    }
  ],
  status
})

describe('SubagentRunPanel unified markdown renderer', () => {
  it('uses rich markdown while the subagent is running', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubagentRunPanel, {
        subagent: makeSubagent('running'),
        onClose: () => undefined
      })
    )

    expect(html).not.toContain('streaming-plain-text')
    expect(html).toMatch(/<strong[^>]*>streaming answer<\/strong>/)
  })

  it('keeps using the same rich markdown renderer after completion', () => {
    const html = renderToStaticMarkup(
      React.createElement(SubagentRunPanel, {
        subagent: makeSubagent('completed'),
        onClose: () => undefined
      })
    )

    expect(html).not.toContain('streaming-plain-text')
    expect(html).toMatch(/<strong[^>]*>streaming answer<\/strong>/)
  })
})
