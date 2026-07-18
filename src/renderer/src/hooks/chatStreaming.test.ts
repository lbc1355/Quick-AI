import { afterEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import type { ChatChunkData, Session } from '../../../shared/types'
import { startStreamingRun } from './chatStreaming'

describe('startStreamingRun context epoch guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops buffered output when the session advances before the frame is flushed', () => {
    let listener: ((data: ChatChunkData) => void) | undefined
    let scheduledFrame: (() => void) | undefined
    const unsubscribe = vi.fn()
    const abortGeneration = vi.fn()
    const setIsGenerating = vi.fn()
    const setActiveReqId = vi.fn()
    const persistActiveSession = vi.fn()
    const onCleanup = vi.fn()
    const start = vi.fn()
    const updateMessageById = vi.fn()
    const initialSession: Session = {
      id: 'session-1',
      title: 'Session',
      contextEpoch: 2,
      messages: [{ id: 'assistant-1', role: 'assistant', content: '' }]
    }
    const sessionsRef = { current: [initialSession] }
    const setSessions = vi.fn((update: React.SetStateAction<Session[]>) => {
      sessionsRef.current = typeof update === 'function' ? update(sessionsRef.current) : update
    })

    vi.stubGlobal('window', {
      api: {
        onChatChunk: vi.fn((callback: (data: ChatChunkData) => void) => {
          listener = callback
          return unsubscribe
        }),
        abortGeneration
      },
      requestAnimationFrame: vi.fn((callback: () => void) => {
        scheduledFrame = callback
        return 7
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout,
      clearTimeout
    })

    startStreamingRun({
      reqId: 'run-1',
      sessionId: 'session-1',
      assistantMsgId: 'assistant-1',
      contextEpoch: 2,
      start,
      formatError: (message) => message,
      setSessions,
      sessionsRef,
      updateMessageById,
      setIsGenerating,
      setActiveReqId,
      persistActiveSession,
      onCleanup
    })

    listener?.({ reqId: 'run-1', contextEpoch: 2, content: 'obsolete output' })
    sessionsRef.current = [{ ...initialSession, contextEpoch: 3 }]
    scheduledFrame?.()
    listener?.({ reqId: 'run-1', contextEpoch: 2, done: true })

    expect(start).toHaveBeenCalledOnce()
    expect(setSessions).not.toHaveBeenCalled()
    expect(sessionsRef.current[0].messages[0].content).toBe('')
    expect(abortGeneration).toHaveBeenCalledWith('run-1')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(setIsGenerating).toHaveBeenCalledWith(false)
    expect(setActiveReqId).toHaveBeenCalledWith(null)
    expect(onCleanup).toHaveBeenCalledOnce()
    expect(persistActiveSession).not.toHaveBeenCalled()
  })
})
