import { describe, expect, it } from 'vitest'
import {
  applySessionRunState,
  getActiveRequestIds,
  getGeneratingSessionIds,
  getSessionGenerationState,
  markSessionFinalizing,
  registerSessionGeneration,
  unregisterSessionGeneration
} from './generationState'

describe('getSessionGenerationState', () => {
  it('marks the current session as generating when ids match', () => {
    expect(getSessionGenerationState(new Set(['s1']), 's1')).toEqual({
      isCurrentSessionGenerating: true,
      isOtherSessionGenerating: false
    })
  })

  it('marks another session as generating when ids differ', () => {
    expect(getSessionGenerationState(new Set(['s1']), 's2')).toEqual({
      isCurrentSessionGenerating: false,
      isOtherSessionGenerating: true
    })
  })

  it('marks both current and other sessions when they generate in parallel', () => {
    expect(getSessionGenerationState(new Set(['s1', 's2']), 's1')).toEqual({
      isCurrentSessionGenerating: true,
      isOtherSessionGenerating: true
    })
  })

  it('does not mark any session when global generation is idle', () => {
    expect(getSessionGenerationState(new Set(), 's1')).toEqual({
      isCurrentSessionGenerating: false,
      isOtherSessionGenerating: false
    })
  })
})

describe('session generation registry', () => {
  it('keeps independent runs active when one of two sessions completes', () => {
    let registry = registerSessionGeneration(new Map(), 's1', {
      requestId: 'run-1',
      assistantMessageId: 'a1',
      phase: 'generating'
    })
    registry = registerSessionGeneration(registry, 's2', {
      requestId: 'run-2',
      assistantMessageId: 'a2',
      phase: 'generating'
    })

    expect([...getGeneratingSessionIds(registry)]).toEqual(['s1', 's2'])
    expect([...getActiveRequestIds(registry)]).toEqual(['run-1', 'run-2'])

    registry = unregisterSessionGeneration(registry, 's1', 'run-1')

    expect([...getGeneratingSessionIds(registry)]).toEqual(['s2'])
    expect(registry.get('s2')).toEqual({
      requestId: 'run-2',
      assistantMessageId: 'a2',
      phase: 'generating'
    })
  })

  it('does not let stale cleanup remove a newer run from the same session', () => {
    let registry = registerSessionGeneration(new Map(), 's1', {
      requestId: 'run-old',
      assistantMessageId: 'a1',
      phase: 'generating'
    })
    registry = registerSessionGeneration(registry, 's1', {
      requestId: 'run-new',
      assistantMessageId: 'a2',
      phase: 'generating'
    })

    const afterStaleCleanup = unregisterSessionGeneration(registry, 's1', 'run-old')

    expect(afterStaleCleanup).toBe(registry)
    expect(afterStaleCleanup.get('s1')?.requestId).toBe('run-new')
  })

  it('tracks non-request activities without exposing an abort request id', () => {
    const registry = registerSessionGeneration(new Map(), 's1', {
      requestId: null,
      assistantMessageId: null,
      phase: 'generating'
    })

    expect([...getGeneratingSessionIds(registry)]).toEqual(['s1'])
    expect([...getActiveRequestIds(registry)]).toEqual([])
  })

  it('stops exposing a finalizing response while keeping cleanup ownership registered', () => {
    const active = registerSessionGeneration(new Map(), 's1', {
      requestId: 'run-1',
      assistantMessageId: 'a1',
      phase: 'generating'
    })
    const finalizing = markSessionFinalizing(active, 's1', 'run-1')

    expect(finalizing.has('s1')).toBe(true)
    expect(finalizing.get('s1')?.phase).toBe('finalizing')
    expect([...getGeneratingSessionIds(finalizing)]).toEqual([])
    expect([...getActiveRequestIds(finalizing)]).toEqual([])

    const idle = unregisterSessionGeneration(finalizing, 's1', 'run-1')
    expect(idle.has('s1')).toBe(false)
  })

  it('applies authoritative phases and ignores stale idle events', () => {
    const generating = applySessionRunState(new Map(), {
      sessionId: 's1',
      requestId: 'run-1',
      contextEpoch: 0,
      phase: 'generating'
    })
    const finalizing = applySessionRunState(generating, {
      sessionId: 's1',
      requestId: 'run-1',
      contextEpoch: 0,
      phase: 'finalizing'
    })
    const afterStaleIdle = applySessionRunState(finalizing, {
      sessionId: 's1',
      requestId: 'run-old',
      contextEpoch: 0,
      phase: 'idle'
    })
    const idle = applySessionRunState(afterStaleIdle, {
      sessionId: 's1',
      requestId: 'run-1',
      contextEpoch: 0,
      phase: 'idle'
    })

    expect(finalizing.get('s1')?.phase).toBe('finalizing')
    expect(afterStaleIdle).toBe(finalizing)
    expect(idle.size).toBe(0)
  })
})
