import { describe, expect, it, vi } from 'vitest'

import { SessionBusyError, SessionCoordinator } from './sessionCoordinator'

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
