import { describe, expect, it, vi } from 'vitest'

import {
  SessionBusyError,
  SessionCoordinator,
  StaleSessionContextError
} from './sessionCoordinator'

describe('SessionCoordinator', () => {
  it('keeps one foreground run per session until the executor settles', async () => {
    const coordinator = new SessionCoordinator()
    let finishFirst: (() => void) | undefined
    const first = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-1',
      kind: 'agent',
      execute: () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    })

    expect(coordinator.getActiveSession('session-1')).toMatchObject({
      reqId: 'req-1',
      kind: 'agent',
      cancelling: false
    })
    const secondExecutor = vi.fn(async (): Promise<void> => undefined)
    await expect(
      coordinator.start({
        sessionId: 'session-1',
        reqId: 'req-2',
        kind: 'chat',
        execute: secondExecutor
      })
    ).rejects.toMatchObject({
      name: 'SessionBusyError',
      sessionId: 'session-1',
      activeReqId: 'req-1'
    })
    expect(secondExecutor).not.toHaveBeenCalled()

    finishFirst?.()
    await first
    expect(coordinator.getActiveSession('session-1')).toBeUndefined()
  })

  it('owns the generating and finalizing phases until executor cleanup settles', async () => {
    const coordinator = new SessionCoordinator()
    const onStarted = vi.fn()
    let finish: (() => void) | undefined
    const run = coordinator.start({
      sessionId: 'session-phases',
      reqId: 'req-phases',
      kind: 'agent',
      onStarted,
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ phase: 'generating' }))
    expect(coordinator.markFinalizing('req-phases')).toMatchObject({
      phase: 'finalizing',
      acceptsSteering: false
    })
    expect(coordinator.getActiveSession('session-phases')?.phase).toBe('finalizing')

    finish?.()
    await run
    expect(coordinator.getActiveSession('session-phases')).toBeUndefined()
  })

  it('routes idempotent request cancellation through the coordinator signal', async () => {
    const coordinator = new SessionCoordinator()
    const run = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-1',
      kind: 'skill',
      execute: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
    })

    expect(coordinator.abortRequest('req-1')).toBe(true)
    expect(coordinator.abortRequest('req-1')).toBe(true)
    expect(coordinator.getActiveRequest('req-1')?.cancelling).toBe(true)
    await run
    expect(coordinator.abortRequest('req-1')).toBe(false)
  })

  it('aborts an older run when the session context epoch advances', async () => {
    const coordinator = new SessionCoordinator()
    const run = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-old',
      kind: 'agent',
      contextEpoch: 2,
      execute: (signal) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })

    expect(coordinator.advanceContext('session-1', 3)).toBe(true)
    expect(coordinator.getActiveRequest('req-old')).toMatchObject({
      contextEpoch: 2,
      cancelling: true
    })
    expect(coordinator.getContextEpoch('session-1')).toBe(3)
    await run

    await expect(
      coordinator.start({
        sessionId: 'session-1',
        reqId: 'req-stale',
        kind: 'chat',
        contextEpoch: 2,
        execute: async () => undefined
      })
    ).rejects.toBeInstanceOf(StaleSessionContextError)
  })

  it('rejects one request id being used by two sessions', async () => {
    const coordinator = new SessionCoordinator()
    let finish: (() => void) | undefined
    const first = coordinator.start({
      sessionId: 'session-1',
      reqId: 'shared-request',
      kind: 'chat',
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })

    await expect(
      coordinator.start({
        sessionId: 'session-2',
        reqId: 'shared-request',
        kind: 'agent',
        execute: async () => undefined
      })
    ).rejects.toBeInstanceOf(SessionBusyError)

    finish?.()
    await first
  })

  it('cleans failed runs so the session can start again', async () => {
    const coordinator = new SessionCoordinator()
    await expect(
      coordinator.start({
        sessionId: 'session-1',
        reqId: 'failed-request',
        kind: 'agent',
        execute: async () => {
          throw new Error('boom')
        }
      })
    ).rejects.toThrow('boom')

    await expect(
      coordinator.start({
        sessionId: 'session-1',
        reqId: 'next-request',
        kind: 'agent',
        execute: async () => undefined
      })
    ).resolves.toBeUndefined()
  })

  it('accepts ordered steering only for runs that opt in', async () => {
    const coordinator = new SessionCoordinator()
    let finish: (() => void) | undefined
    const run = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-1',
      kind: 'agent',
      acceptsSteering: true,
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })

    expect(
      coordinator.steer('session-1', {
        admissionId: 'prompt-1',
        messages: [{ role: 'user', content: 'first' }]
      })
    ).toBe(true)
    expect(
      coordinator.steer('session-1', {
        admissionId: 'prompt-2',
        messages: [{ role: 'user', content: 'second' }]
      })
    ).toBe(true)
    expect(coordinator.getActiveRequest('req-1')).toMatchObject({
      acceptsSteering: true,
      pendingSteeringCount: 2
    })

    expect(coordinator.drainSteering('req-1').map((item) => item.admissionId)).toEqual([
      'prompt-1',
      'prompt-2'
    ])
    expect(coordinator.drainSteering('req-1')).toEqual([])
    finish?.()
    await run
  })

  it('rejects steering captured from a different context epoch', async () => {
    const coordinator = new SessionCoordinator()
    let finish: (() => void) | undefined
    const run = coordinator.start({
      sessionId: 'session-epoch',
      reqId: 'req-epoch',
      kind: 'agent',
      contextEpoch: 4,
      acceptsSteering: true,
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })

    expect(
      coordinator.steer('session-epoch', {
        admissionId: 'stale-prompt',
        contextEpoch: 3,
        messages: [{ role: 'user', content: 'stale' }]
      })
    ).toBe(false)
    expect(
      coordinator.steer('session-epoch', {
        admissionId: 'current-prompt',
        contextEpoch: 4,
        messages: [{ role: 'user', content: 'current' }]
      })
    ).toBe(true)

    coordinator.drainSteering('req-epoch')
    finish?.()
    await run
  })

  it('closes steering atomically at a terminal boundary', async () => {
    const coordinator = new SessionCoordinator()
    let finish: (() => void) | undefined
    const run = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-1',
      kind: 'agent',
      acceptsSteering: true,
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })

    coordinator.steer('session-1', {
      admissionId: 'prompt-1',
      messages: [{ role: 'user', content: 'late prompt' }]
    })
    expect(coordinator.drainSteering('req-1', true)).toHaveLength(1)
    expect(
      coordinator.steer('session-1', {
        admissionId: 'prompt-2',
        messages: [{ role: 'user', content: 'too late' }]
      })
    ).toBe(false)

    finish?.()
    await run
  })

  it('returns unconsumed steering to the owner when a run settles', async () => {
    const coordinator = new SessionCoordinator()
    const onUnconsumedSteering = vi.fn()
    let finish: (() => void) | undefined
    const run = coordinator.start({
      sessionId: 'session-1',
      reqId: 'req-1',
      kind: 'agent',
      acceptsSteering: true,
      onUnconsumedSteering,
      execute: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    })
    coordinator.steer('session-1', {
      admissionId: 'prompt-1',
      messages: [{ role: 'user', content: 'preserve me' }]
    })

    finish?.()
    await run
    expect(onUnconsumedSteering).toHaveBeenCalledWith([
      expect.objectContaining({ admissionId: 'prompt-1' })
    ])
  })

  it('rejects steering for chat and cancelling runs', async () => {
    const coordinator = new SessionCoordinator()
    let finishChat: (() => void) | undefined
    const chat = coordinator.start({
      sessionId: 'chat-session',
      reqId: 'chat-request',
      kind: 'chat',
      execute: () =>
        new Promise<void>((resolve) => {
          finishChat = resolve
        })
    })
    expect(
      coordinator.steer('chat-session', {
        admissionId: 'prompt-chat',
        messages: [{ role: 'user', content: 'queued instead' }]
      })
    ).toBe(false)
    finishChat?.()
    await chat

    const agent = coordinator.start({
      sessionId: 'agent-session',
      reqId: 'agent-request',
      kind: 'agent',
      acceptsSteering: true,
      execute: (signal) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })
    coordinator.abortRequest('agent-request')
    expect(
      coordinator.steer('agent-session', {
        admissionId: 'prompt-agent',
        messages: [{ role: 'user', content: 'too late' }]
      })
    ).toBe(false)
    await agent
  })
})
