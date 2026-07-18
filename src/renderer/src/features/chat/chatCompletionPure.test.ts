import { describe, it, expect, vi } from 'vitest'
import { getMessagesForLLM, buildApiMessages } from './apiMessageBuilder'
import { getCachePriorityRetainedRuns, computeRemovedRunIds } from './resourceCacheCoordinator'
import {
  resolveSessionForSend,
  getProjectRunContext,
  prepareEditOrForkMutation,
  prepareResumeMutation
} from './sessionMutationService'
import type { Message, Session, Project } from '../../../../shared/types'

// Mock the dependencies imported by sessionMutationService
vi.mock('../../hooks/sessionBranching', () => ({
  createForkedSession: vi.fn(({ sourceSession, transformMessage }) => {
    return {
      ...sourceSession,
      id: 'forked-session-id',
      messages: sourceSession.messages.map((m: unknown, idx: number) => transformMessage(m, idx))
    }
  }),
  getRunIdsThroughMessage: vi.fn().mockReturnValue(['run-1', 'run-2'])
}))

vi.mock('../../hooks/chatMessageEvents', () => ({
  isRuntimeErrorAssistantMessage: vi.fn((msg: Message) => {
    return msg.role === 'assistant' && msg.isRuntimeError === true
  }),
  prepareMessageForInlineResume: vi.fn((msg: Message, reqId: string) => ({
    ...msg,
    content: 'resumed-content',
    agentRunId: reqId
  }))
}))

describe('apiMessageBuilder pure functions', () => {
  it('getMessagesForLLM slices after compaction summary', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi', isCompactionSummary: true },
      { id: '3', role: 'user', content: 'how are you' }
    ]
    const result = getMessagesForLLM(messages)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('2')
    expect(result[1].id).toBe('3')
  })

  it('buildApiMessages builds system prompt and formats files correctly', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'prompt text',
        files: [
          { name: 'img.png', type: 'image', content: 'data:image/png;base64,123' },
          { name: 'ref.txt', type: 'text', content: 'file content' }
        ]
      }
    ]
    const apiMsgs = buildApiMessages('system-prompt', messages)
    expect(apiMsgs.length).toBe(2)
    expect(apiMsgs[0]).toEqual({ role: 'system', content: 'system-prompt' })
    expect(apiMsgs[1].role).toBe('user')
    expect(Array.isArray(apiMsgs[1].content)).toBe(true)
    const contentArr = apiMsgs[1].content as Array<{
      type: string
      text?: string
      image_url?: { url: string }
    }>
    expect(contentArr[0]).toEqual({
      type: 'text',
      text: 'prompt text\n\n[参考文件: ref.txt]\nfile content'
    })
    expect(contentArr[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,123' }
    })
  })

  it('buildApiMessages keeps historical user date context stable across midnight', () => {
    const firstUserId = String(new Date('2026-06-08T12:00:00').getTime())
    const nextUserId = String(new Date('2026-06-09T12:00:00').getTime())
    const firstRequest = buildApiMessages('system', [
      { id: firstUserId, role: 'user', content: 'first task' }
    ])
    const nextRequest = buildApiMessages('system', [
      { id: firstUserId, role: 'user', content: 'first task' },
      { id: 'assistant-1', role: 'assistant', content: 'answer' },
      { id: nextUserId, role: 'user', content: 'second task' }
    ])

    expect(nextRequest[1]).toEqual(firstRequest[1])
    expect(nextRequest[1].content).toContain('<date_context>')
    expect(nextRequest[1].content).toContain('2026-06-08')
    expect(nextRequest[1].content).toContain('</date_context>')
    expect(nextRequest[3].content).toContain('2026-06-09')
  })

  it('buildApiMessages only anchors the date when the calendar day changes', () => {
    const firstUserId = String(new Date('2026-06-08T09:00:00').getTime())
    const sameDayUserId = String(new Date('2026-06-08T21:00:00').getTime())
    const nextDayUserId = String(new Date('2026-06-09T08:00:00').getTime())

    const apiMsgs = buildApiMessages('system', [
      { id: firstUserId, role: 'user', content: 'first task' },
      { id: 'assistant-1', role: 'assistant', content: 'answer 1' },
      { id: sameDayUserId, role: 'user', content: 'same day task' },
      { id: 'assistant-2', role: 'assistant', content: 'answer 2' },
      { id: nextDayUserId, role: 'user', content: 'next day task' }
    ])

    // First user message on 2026-06-08 gets the anchor.
    expect(apiMsgs[1].content).toContain('<date_context>')
    expect(apiMsgs[1].content).toContain('2026-06-08')
    // Second user message on the same day is NOT re-anchored.
    expect(apiMsgs[3].content).toBe('same day task')
    expect(apiMsgs[3].content).not.toContain('<date_context>')
    // Third user message on a new day gets a fresh anchor.
    expect(apiMsgs[5].content).toContain('<date_context>')
    expect(apiMsgs[5].content).toContain('2026-06-09')
  })

  it('buildApiMessages crops context correctly after a compaction summary', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'old query 1' },
      { id: '2', role: 'assistant', content: 'summary', isCompactionSummary: true },
      { id: '3', role: 'user', content: 'new query 2' }
    ]
    const apiMsgs = buildApiMessages('system', messages)
    // Should crop so index 0 is system, index 1 is compaction summary, index 2 is new query
    expect(apiMsgs.length).toBe(3)
    expect(apiMsgs[0]).toEqual({ role: 'system', content: 'system' })
    expect(apiMsgs[1]).toEqual({ role: 'assistant', content: 'summary' })
    expect(apiMsgs[2]).toEqual({ role: 'user', content: 'new query 2' })
  })
})

describe('resourceCacheCoordinator pure functions', () => {
  it('getCachePriorityRetainedRuns returns undefined if mode is not cache-priority', () => {
    const messages: Message[] = [
      { id: '1', role: 'assistant', content: 'text', agentRunId: 'run-1' }
    ]
    const result = getCachePriorityRetainedRuns(messages, 'default', 'sys')
    expect(result).toBeUndefined()
  })

  it('getCachePriorityRetainedRuns correctly indexes messages with systemPrompt shifts', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'prompt' },
      { id: '2', role: 'assistant', content: 'text', agentRunId: 'run-1', agentRunIds: ['run-1'] }
    ]
    const result = getCachePriorityRetainedRuns(messages, 'cache-priority', 'sys-prompt')
    expect(result).toEqual([{ runId: 'run-1', assistantMessageIndex: 2 }])
  })

  it('computeRemovedRunIds finds agentRunIds in subsequent assistant messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'prompt' },
      { id: '2', role: 'assistant', content: 'text', agentRunId: 'run-1' },
      { id: '3', role: 'user', content: 'edit this' },
      { id: '4', role: 'assistant', content: 'text2', agentRunId: 'run-2' }
    ]
    const result = computeRemovedRunIds(messages, 1) // Slice after index 1
    expect(result).toEqual(['run-2'])
  })
})

describe('sessionMutationService pure functions', () => {
  it('resolveSessionForSend returns active session or prepends draft session', () => {
    const sessions: Session[] = [{ id: 's1', title: 'Session 1', messages: [], lastActiveTime: 0 }]
    const { session, updatedSessions } = resolveSessionForSend(sessions, 's1', null)
    expect(session.id).toBe('s1')
    expect(updatedSessions).toBe(sessions)

    const draft: Session = { id: 'draft-1', title: 'New', messages: [], lastActiveTime: 0 }
    const {
      session: s2,
      updatedSessions: u2,
      draftSessionCleared
    } = resolveSessionForSend(sessions, 'draft-1', draft)
    expect(s2.id).toBe('draft-1')
    expect(u2[0].id).toBe('draft-1')
    expect(draftSessionCleared).toBe(true)
  })

  it('getProjectRunContext retrieves context for projectId', () => {
    const session: Session = {
      id: 's1',
      title: '',
      messages: [],
      lastActiveTime: 0,
      projectId: 'p1'
    }
    const projects: Project[] = [
      { id: 'p1', name: 'Project 1', path: '/path/1', createdAt: 0, updatedAt: 0 }
    ]
    const context = getProjectRunContext(session, projects)
    expect(context).toEqual({ projectName: 'Project 1', projectRoot: '/path/1' })
  })

  it('prepareEditOrForkMutation handles normal edit and forks correctly', () => {
    const currentSession: Session = {
      id: 's1',
      title: 'S1',
      lastActiveTime: 0,
      messages: [
        { id: 'msg-1', role: 'user', content: 'prompt 1' },
        { id: 'msg-2', role: 'assistant', content: 'text 1', agentRunId: 'run-1' }
      ]
    }

    // Normal edit on the last message
    const normalEdit = prepareEditOrForkMutation({
      currentSession,
      promptToSend: 'new prompt',
      msgId: 'msg-2',
      forceBranch: false,
      now: 1000
    })
    expect(normalEdit.isForked).toBe(false)
    expect(normalEdit.targetSession.messages[1].content).toBe('new prompt')
    expect(normalEdit.targetSession.contextEpoch).toBe(1)

    // Branch fork on historical message
    const forkEdit = prepareEditOrForkMutation({
      currentSession,
      promptToSend: 'forked prompt',
      msgId: 'msg-1',
      forceBranch: true,
      now: 1000
    })
    expect(forkEdit.isForked).toBe(true)
    expect(forkEdit.targetSession.contextEpoch).toBe(1)
    expect(forkEdit.forkedCachePayload?.runIds).toEqual(['run-1', 'run-2'])
  })

  it('prepareEditOrForkMutation defaults to fork for historical message edit', () => {
    const currentSession: Session = {
      id: 's1',
      title: 'S1',
      lastActiveTime: 0,
      messages: [
        { id: 'msg-1', role: 'user', content: 'prompt 1' },
        { id: 'msg-2', role: 'assistant', content: 'text 1', agentRunId: 'run-1' }
      ]
    }

    // Editing index 0 (msg-1) while forceBranch is undefined (defaults to true since 0 < 1)
    const result = prepareEditOrForkMutation({
      currentSession,
      promptToSend: 'edited historical message',
      msgId: 'msg-1',
      now: 1000
    })
    expect(result.isForked).toBe(true)
  })

  it('prepareEditOrForkMutation defaults to non-fork for the latest message edit', () => {
    const currentSession: Session = {
      id: 's1',
      title: 'S1',
      lastActiveTime: 0,
      messages: [
        { id: 'msg-1', role: 'user', content: 'prompt 1' },
        { id: 'msg-2', role: 'assistant', content: 'text 1', agentRunId: 'run-1' }
      ]
    }

    // Editing index 1 (msg-2) while forceBranch is undefined (defaults to false since 1 is not < 1)
    const result = prepareEditOrForkMutation({
      currentSession,
      promptToSend: 'edited latest message',
      msgId: 'msg-2',
      now: 1000
    })
    expect(result.isForked).toBe(false)
    expect(result.targetSession.messages.length).toBe(2) // Keeps both, updates msg-2
    expect(result.targetSession.messages[1].content).toBe('edited latest message')
  })

  it('prepareResumeMutation handles normal resume and historical fork resume correctly', () => {
    const currentSession: Session = {
      id: 's1',
      title: 'S1',
      lastActiveTime: 0,
      messages: [
        { id: 'msg-1', role: 'user', content: 'prompt 1' },
        { id: 'msg-2', role: 'assistant', content: 'failed', agentRunId: 'run-1' }
      ]
    }

    // Normal resume on the last message
    const normalResume = prepareResumeMutation({
      currentSession,
      msgIdx: 1,
      reqId: 'new-run-1',
      now: 1000
    })
    expect(normalResume.isHistoricalResume).toBe(false)
    expect(normalResume.targetSession.messages[1].agentRunId).toBe('new-run-1')
    expect(normalResume.targetSession.contextEpoch).toBe(1)

    // Historical resume on first message
    const historicalSession: Session = {
      ...currentSession,
      messages: [...currentSession.messages, { id: 'msg-3', role: 'user', content: 'prompt 2' }]
    }
    const histResume = prepareResumeMutation({
      currentSession: historicalSession,
      msgIdx: 1,
      reqId: 'new-run-3',
      now: 1000
    })
    expect(histResume.isHistoricalResume).toBe(true)
    expect(histResume.branchOf?.runId).toBe('run-1')
    expect(histResume.targetSession.contextEpoch).toBe(1)
  })
})
