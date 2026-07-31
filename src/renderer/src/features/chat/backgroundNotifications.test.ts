import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import {
  applyEpochScopedNotification,
  applyEpochScopedNotifications,
  shouldDrainAfterNotification
} from './backgroundNotifications'

const sessions = (): Session[] => [
  { id: 's1', title: 'a', messages: [], contextEpoch: 2 },
  { id: 's2', title: 'b', messages: [], contextEpoch: 0 }
]

const rename =
  (title: string) =>
  (session: Session): Session => ({ ...session, title })

describe('applyEpochScopedNotification', () => {
  it('applies to the matching session when the epoch is current', () => {
    const next = applyEpochScopedNotification(
      sessions(),
      { sessionId: 's1', contextEpoch: 2 },
      rename('updated')
    )
    expect(next?.[0].title).toBe('updated')
    expect(next?.[1].title).toBe('b')
  })

  it('discards a result produced before the context was reset', () => {
    const next = applyEpochScopedNotification(
      sessions(),
      { sessionId: 's1', contextEpoch: 1 },
      rename('stale')
    )
    expect(next).toBeUndefined()
  })

  it('discards a result for a session that no longer exists', () => {
    const next = applyEpochScopedNotification(
      sessions(),
      { sessionId: 'deleted', contextEpoch: 0 },
      rename('gone')
    )
    expect(next).toBeUndefined()
  })

  it('treats a missing epoch on the session as epoch zero', () => {
    const withoutEpoch: Session[] = [{ id: 's1', title: 'a', messages: [] }]
    expect(
      applyEpochScopedNotification(withoutEpoch, { sessionId: 's1', contextEpoch: 0 }, rename('ok'))
    ).toBeDefined()
  })
})

describe('applyEpochScopedNotifications', () => {
  it('folds a batch and reports that something changed', () => {
    const result = applyEpochScopedNotifications(
      sessions(),
      [
        { sessionId: 's1', contextEpoch: 2 },
        { sessionId: 's2', contextEpoch: 0 }
      ],
      (session) => ({ ...session, title: `${session.title}!` })
    )
    expect(result.changed).toBe(true)
    expect(result.sessions.map((s) => s.title)).toEqual(['a!', 'b!'])
  })

  it('keeps the fresh events in a batch that also contains stale ones', () => {
    const result = applyEpochScopedNotifications(
      sessions(),
      [
        { sessionId: 's1', contextEpoch: 99 },
        { sessionId: 's2', contextEpoch: 0 }
      ],
      rename('applied')
    )
    expect(result.sessions[0].title).toBe('a')
    expect(result.sessions[1].title).toBe('applied')
  })

  it('reports no change when every event was stale', () => {
    const result = applyEpochScopedNotifications(
      sessions(),
      [{ sessionId: 's1', contextEpoch: 99 }],
      rename('never')
    )
    expect(result.changed).toBe(false)
  })

  it('reports no change when the reducer returned the same session', () => {
    const result = applyEpochScopedNotifications(
      sessions(),
      [{ sessionId: 's1', contextEpoch: 2 }],
      (session) => session
    )
    expect(result.changed).toBe(false)
  })
})

describe('shouldDrainAfterNotification', () => {
  const queued = { sessionId: 's1', contextEpoch: 0, disposition: 'queued' }

  it('drains a queued result when its session is idle', () => {
    expect(shouldDrainAfterNotification(queued, false)).toBe(true)
  })

  it('waits while the originating session still has a run in flight', () => {
    expect(shouldDrainAfterNotification(queued, true)).toBe(false)
  })

  it('ignores a steered result, which needs no run of its own', () => {
    expect(shouldDrainAfterNotification({ ...queued, disposition: 'steered' }, false)).toBe(false)
  })
})
