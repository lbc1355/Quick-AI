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
    expect(onCleanup).toHaveBeenCalledOnce()
    expect(persistActiveSession).not.toHaveBeenCalled()
  })

  it('routes simultaneous streams to their own sessions and settles them independently', () => {
    const listeners: Array<(data: ChatChunkData) => void> = []
    const scheduledFrames: Array<() => void> = []
    const cleanupFirst = vi.fn()
    const cleanupSecond = vi.fn()
    const persistActiveSession = vi.fn()
    const sessionsRef: React.MutableRefObject<Session[]> = {
      current: [
        {
          id: 'session-1',
          title: 'First',
          contextEpoch: 0,
          messages: [{ id: 'assistant-1', role: 'assistant' as const, content: '' }]
        },
        {
          id: 'session-2',
          title: 'Second',
          contextEpoch: 0,
          messages: [{ id: 'assistant-2', role: 'assistant' as const, content: '' }]
        }
      ]
    }
    const setSessions = vi.fn((update: React.SetStateAction<Session[]>) => {
      sessionsRef.current = typeof update === 'function' ? update(sessionsRef.current) : update
    })
    const updateMessageById = vi.fn()

    vi.stubGlobal('window', {
      api: {
        onChatChunk: vi.fn((callback: (data: ChatChunkData) => void) => {
          listeners.push(callback)
          return vi.fn()
        }),
        abortGeneration: vi.fn()
      },
      requestAnimationFrame: vi.fn((callback: () => void) => {
        scheduledFrames.push(callback)
        return scheduledFrames.length
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout,
      clearTimeout
    })

    const startRun = (
      reqId: string,
      sessionId: string,
      assistantMsgId: string,
      onCleanup: () => void
    ): void => {
      startStreamingRun({
        reqId,
        sessionId,
        assistantMsgId,
        contextEpoch: 0,
        start: vi.fn(),
        formatError: (message) => message,
        setSessions,
        sessionsRef,
        updateMessageById,
        persistActiveSession,
        onCleanup
      })
    }
    const broadcast = (data: ChatChunkData): void => {
      listeners.forEach((listener) => listener(data))
    }
    const flushFrames = (): void => {
      scheduledFrames.splice(0).forEach((frame) => frame())
    }

    startRun('run-1', 'session-1', 'assistant-1', cleanupFirst)
    startRun('run-2', 'session-2', 'assistant-2', cleanupSecond)

    broadcast({ reqId: 'run-1', contextEpoch: 0, content: 'first output' })
    flushFrames()

    expect(sessionsRef.current[0].messages[0].content).toBe('first output')
    expect(sessionsRef.current[1].messages[0].content).toBe('')

    broadcast({ reqId: 'run-1', contextEpoch: 0, done: true })
    expect(cleanupFirst).toHaveBeenCalledOnce()
    expect(cleanupSecond).not.toHaveBeenCalled()

    broadcast({ reqId: 'run-2', contextEpoch: 0, content: 'second output' })
    flushFrames()

    expect(sessionsRef.current[0].messages[0].content).toBe('first output')
    expect(sessionsRef.current[1].messages[0].content).toBe('second output')

    broadcast({ reqId: 'run-2', contextEpoch: 0, done: true })
    expect(cleanupSecond).toHaveBeenCalledOnce()
    expect(persistActiveSession).toHaveBeenCalledTimes(2)
  })
})
