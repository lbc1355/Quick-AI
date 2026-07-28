import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../shared/types'
import {
  createMessagePairIds,
  createRunId,
  deriveSessionTitle,
  isDefaultSessionTitle,
  shouldAutoDeriveSessionTitle
} from './runIdentity'

const sessionWith = (ids: string[]): Session => ({
  id: 'session-1',
  title: 'Session',
  messages: ids.map((id) => ({ id, role: 'user' as const, content: id }))
})

describe('createRunId', () => {
  it('combines the prefix, timestamp and a random suffix', () => {
    const id = createRunId('queued-run-', { now: () => 1700, random: () => 0.5 })
    expect(id.startsWith('queued-run-1700-')).toBe(true)
  })

  it('produces distinct ids for the same timestamp', () => {
    let seed = 0
    const clock = { now: () => 1700, random: (): number => (seed += 0.1) }
    expect(createRunId('', clock)).not.toBe(createRunId('', clock))
  })
})

describe('createMessagePairIds', () => {
  it('uses the current timestamp and its successor when both are free', () => {
    const pair = createMessagePairIds([sessionWith(['1', '2'])], 100)
    expect(pair).toEqual({ sourceMessageId: '100', assistantMessageId: '101' })
  })

  it('walks past a timestamp already taken by an existing message', () => {
    const pair = createMessagePairIds([sessionWith(['100'])], 100)
    expect(pair).toEqual({ sourceMessageId: '102', assistantMessageId: '103' })
  })

  it('also avoids collisions on the assistant half of the pair', () => {
    // 100 is free but 101 is taken — claiming it would overwrite the existing message.
    const pair = createMessagePairIds([sessionWith(['101'])], 100)
    expect(pair).toEqual({ sourceMessageId: '102', assistantMessageId: '103' })
  })

  it('checks every session, not just the active one', () => {
    const pair = createMessagePairIds(
      [sessionWith(['500']), { ...sessionWith(['100']), id: 'other' }],
      100
    )
    expect(pair.sourceMessageId).toBe('102')
  })
})

describe('deriveSessionTitle', () => {
  it('truncates a long prompt', () => {
    expect(deriveSessionTitle('0123456789abcdefghij', 'Chat')).toBe('0123456789abcde')
  })

  it('falls back when the prompt is empty', () => {
    expect(deriveSessionTitle('', 'Agent Skill')).toBe('Agent Skill')
  })

  it('keeps a short prompt intact', () => {
    expect(deriveSessionTitle('hello', 'Chat')).toBe('hello')
  })
})

describe('isDefaultSessionTitle', () => {
  it('treats empty and placeholder titles as default', () => {
    expect(isDefaultSessionTitle(undefined)).toBe(true)
    expect(isDefaultSessionTitle('')).toBe(true)
    expect(isDefaultSessionTitle('新对话')).toBe(true)
    expect(isDefaultSessionTitle('Chat')).toBe(true)
  })

  it('treats a user-chosen title as custom', () => {
    expect(isDefaultSessionTitle('项目复盘')).toBe(false)
  })

  it('does not auto-derive over an explicitly renamed placeholder title', () => {
    expect(
      shouldAutoDeriveSessionTitle({
        title: 'Chat',
        titleManuallyEdited: true
      })
    ).toBe(false)
    expect(shouldAutoDeriveSessionTitle({ title: 'Chat' })).toBe(true)
  })
})
