import { describe, expect, it } from 'vitest'
import {
  createAssistantPlaceholder,
  createHelpMessage,
  createQueuedAssistantPlaceholder,
  createUserMessage,
  markMessageAsRuntimeError
} from './chatMessageFactory'

describe('createUserMessage', () => {
  it('copies the attachment list so later clearing does not empty the sent message', () => {
    const files = [{ name: 'a.png', content: 'data', type: 'image/png' }]
    const message = createUserMessage({ id: '1', content: 'look', files })
    files.length = 0
    expect(message.files).toHaveLength(1)
  })

  it('defaults to no attachments', () => {
    expect(createUserMessage({ id: '1', content: 'hi' }).files).toEqual([])
  })
})

describe('createAssistantPlaceholder', () => {
  it('attaches run ids and an event array for an agent run', () => {
    const message = createAssistantPlaceholder({ id: '2', runMode: 'agent', runId: 'run-1' })
    expect(message).toMatchObject({
      agentRunId: 'run-1',
      agentRunIds: ['run-1'],
      agentEvents: []
    })
  })

  it('stays bare for a chat run so it is not mistaken for an agent timeline', () => {
    const message = createAssistantPlaceholder({ id: '2', runMode: 'chat', runId: 'run-1' })
    expect(message.agentRunId).toBeUndefined()
    expect(message.agentEvents).toBeUndefined()
  })

  it('marks a fork so the bubble can show its branch origin', () => {
    const branchOf = { sessionId: 's0', messageId: 'm0', runId: 'run-0' }
    const message = createAssistantPlaceholder({ id: '2', runMode: 'chat', branchOf })
    expect(message.isBranchFork).toBe(true)
    expect(message.forkedFrom).toEqual(branchOf)
  })
})

describe('queue and error presentation', () => {
  it('labels a queued placeholder', () => {
    expect(createQueuedAssistantPlaceholder('3').content).toContain('已加入队列')
  })

  it('flags a failed admission without dropping the message identity', () => {
    const message = markMessageAsRuntimeError(
      { id: '3', role: 'assistant', content: 'pending' },
      'failed'
    )
    expect(message).toMatchObject({ id: '3', content: 'failed', isRuntimeError: true })
  })

  it('derives a stable help message id from the clock', () => {
    expect(createHelpMessage(42).id).toBe('help-42')
  })
})
