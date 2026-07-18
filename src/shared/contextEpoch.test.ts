import { describe, expect, it } from 'vitest'
import {
  advanceSessionContextEpoch,
  getSessionContextEpoch,
  isSessionContextEpochCurrent,
  normalizeContextEpoch
} from './contextEpoch'

describe('contextEpoch', () => {
  it('normalizes legacy and malformed epoch values', () => {
    expect(normalizeContextEpoch(undefined)).toBe(0)
    expect(normalizeContextEpoch(-1)).toBe(0)
    expect(normalizeContextEpoch(Number.NaN)).toBe(0)
    expect(normalizeContextEpoch(2.9)).toBe(2)
  })

  it('advances a session without mutating the original', () => {
    const session = { id: 'session-1', contextEpoch: 4 }
    const next = advanceSessionContextEpoch(session)

    expect(next.contextEpoch).toBe(5)
    expect(session.contextEpoch).toBe(4)
  })

  it('treats legacy sessions as epoch zero and rejects missing or newer sessions', () => {
    const sessions = [{ id: 'legacy' }, { id: 'current', contextEpoch: 3 }]

    expect(getSessionContextEpoch(sessions[0])).toBe(0)
    expect(isSessionContextEpochCurrent(sessions, 'legacy', 0)).toBe(true)
    expect(isSessionContextEpochCurrent(sessions, 'current', 3)).toBe(true)
    expect(isSessionContextEpochCurrent(sessions, 'current', 2)).toBe(false)
    expect(isSessionContextEpochCurrent(sessions, 'missing', 0)).toBe(false)
  })
})
