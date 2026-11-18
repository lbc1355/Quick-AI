import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../../shared/types'
import { createSessionPersistenceQueue } from './sessionPersistenceQueue'
import { cloneSessionsDeep } from './sessionSnapshot'

const snapshot = (content: string): Session[] => [
  { id: 'session', title: 'Session', messages: [{ id: 'message', role: 'user', content }] }
]

describe('session persistence queue', () => {
  it('waits for the preceding write and saves the message as it was when enqueued', async () => {
    const started = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<void>()
    const write = vi.fn<(sessions: Session[]) => Promise<void>>()
    write.mockImplementationOnce(() => {
      started.resolve()
      return finishFirst.promise
    })
    write.mockResolvedValue(undefined)
    const persist = createSessionPersistenceQueue(write, cloneSessionsDeep)

    let firstSaved = false
    const first = persist(snapshot('first')).then(() => {
      firstSaved = true
    })
    await started.promise
    const next = snapshot('second')
    const second = persist(next)
    next[0].messages[0].content = 'edited after enqueue'

    try {
      await Promise.resolve()
      expect(write).toHaveBeenCalledExactlyOnceWith(snapshot('first'))
      expect(firstSaved).toBe(false)
    } finally {
      finishFirst.resolve()
      await Promise.all([first, second])
    }
    expect(firstSaved).toBe(true)
    expect(write).toHaveBeenNthCalledWith(2, snapshot('second'))
  })

  it('reports a failed write and still completes a later queued write', async () => {
    const failure = new Error('write failed')
    const write = vi
      .fn<(sessions: Session[]) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const persist = createSessionPersistenceQueue(write, cloneSessionsDeep)

    const first = persist(snapshot('failed'))
    const second = persist(snapshot('saved'))

    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBeUndefined()
    expect(write).toHaveBeenNthCalledWith(2, snapshot('saved'))
  })
})
