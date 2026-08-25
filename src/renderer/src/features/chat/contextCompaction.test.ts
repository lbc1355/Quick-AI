import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../shared/types'
import {
  applyCompactionResult,
  assessContextCompactionPressure,
  canCompactMessages,
  createCompactionSummaryMessage,
  formatCompactionSummaryMessage,
  getMessagesForCompaction,
  MANUAL_COMPACTION_KEEP_RECENT_MESSAGES,
  selectAutoCompactionKeepRecentMessages
} from './contextCompaction'

const messages = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index}`
  }))

describe('canCompactMessages', () => {
  it('refuses when the history is no longer than the tail it would keep', () => {
    expect(canCompactMessages(messages(MANUAL_COMPACTION_KEEP_RECENT_MESSAGES))).toBe(false)
    expect(canCompactMessages(messages(MANUAL_COMPACTION_KEEP_RECENT_MESSAGES + 1))).toBe(false)
  })

  it('allows compaction once there is at least one message to summarise', () => {
    expect(canCompactMessages(messages(MANUAL_COMPACTION_KEEP_RECENT_MESSAGES + 2))).toBe(true)
  })

  it('counts only the effective context after the latest checkpoint', () => {
    const history = messages(20)
    history[14] = { ...history[14], isCompactionSummary: true }

    expect(getMessagesForCompaction(history).map((message) => message.id)).toEqual(
      history.slice(14).map((message) => message.id)
    )
    expect(canCompactMessages(history)).toBe(false)
  })
})

describe('assessContextCompactionPressure', () => {
  it('triggers when the durable conversation request crosses the threshold', () => {
    const history = messages(10)

    expect(
      assessContextCompactionPressure({
        messages: history,
        requestMessages: [{ role: 'user', content: 'x'.repeat(3400) }],
        contextWindowTokens: 1000
      })
    ).toEqual({
      shouldCompact: true,
      measuredTokens: 854,
      triggerTokens: 800
    })
  })

  it('does not treat provider usage from tool replay as durable conversation pressure', () => {
    const history = messages(10)
    history[history.length - 2] = {
      ...history[history.length - 2],
      role: 'assistant',
      cacheStats: { promptTokens: 900, cacheHitTokens: 0, cacheMissTokens: 900, hitRate: 0 }
    }

    expect(
      assessContextCompactionPressure({
        messages: history,
        requestMessages: [{ role: 'user', content: 'small request' }],
        contextWindowTokens: 1000
      }).shouldCompact
    ).toBe(false)
  })

  it('does not compact below pressure or when the effective tail is too short', () => {
    const history = messages(10)
    expect(
      assessContextCompactionPressure({
        messages: history,
        requestMessages: [{ role: 'user', content: 'small request' }],
        contextWindowTokens: 1000
      }).shouldCompact
    ).toBe(false)

    history[3] = { ...history[3], isCompactionSummary: true }
    expect(
      assessContextCompactionPressure({
        messages: history,
        requestMessages: [{ role: 'user', content: 'x'.repeat(3400) }],
        contextWindowTokens: 1000
      }).shouldCompact
    ).toBe(false)
  })
})

describe('selectAutoCompactionKeepRecentMessages', () => {
  it('retains a recent token budget instead of a fixed number of messages', () => {
    const history = messages(10).map((message) => ({
      ...message,
      content: 'x'.repeat(400)
    }))

    expect(
      selectAutoCompactionKeepRecentMessages({
        messages: history,
        contextWindowTokens: 1000
      })
    ).toBe(2)
  })

  it('refuses to manufacture a compactable range when the entire tail is below retention', () => {
    expect(
      selectAutoCompactionKeepRecentMessages({
        messages: messages(8),
        contextWindowTokens: 100_000
      })
    ).toBe(8)
  })

  it('prices only the effective history after the latest checkpoint', () => {
    const history = messages(12)
    history[7] = { ...history[7], isCompactionSummary: true }

    expect(
      selectAutoCompactionKeepRecentMessages({
        messages: history,
        contextWindowTokens: 100_000
      })
    ).toBe(5)
  })
})

describe('formatCompactionSummaryMessage', () => {
  it('reports the split and the generation speed when available', () => {
    const text = formatCompactionSummaryMessage({
      summary: 'we discussed the parser',
      compactedCount: 10,
      keptCount: 6,
      tokenSpeed: 42
    })
    expect(text).toContain('前 10 条历史消息')
    expect(text).toContain('最近 6 条消息保留原文')
    expect(text).toContain('42 token/s')
    expect(text).toContain('we discussed the parser')
  })

  it('drops the speed line when the provider reported none', () => {
    const text = formatCompactionSummaryMessage({
      summary: 'summary',
      compactedCount: 3,
      keptCount: 2
    })
    expect(text).not.toContain('token/s')
  })
})

describe('applyCompactionResult', () => {
  it('splices the summary between the compacted history and the kept tail', () => {
    const result = applyCompactionResult({
      messages: messages(5),
      result: { summary: 's', compactedCount: 3, keptCount: 2 },
      now: 1000
    })

    expect(result.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'compact-1000', 'm3', 'm4'])
  })

  it('keeps the compacted messages so the user can still scroll back through them', () => {
    const result = applyCompactionResult({
      messages: messages(6),
      result: { summary: 's', compactedCount: 4, keptCount: 2 },
      now: 1
    })
    expect(result).toHaveLength(7)
  })

  it('preserves messages appended after the compacted boundary (background results landing mid-compaction)', () => {
    // 7 messages at compaction start (compact 1, keep 6); a background result appends m6..m8 while
    // the model summarizes. Merging into the latest list must keep every message after the
    // compacted boundary, not just the original kept tail.
    const result = applyCompactionResult({
      messages: messages(9),
      result: { summary: 's', compactedCount: 1, keptCount: 6 },
      now: 1000
    })
    expect(result.map((m) => m.id)).toEqual([
      'm0',
      'compact-1000',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8'
    ])
  })

  it('marks the summary so context cropping can find the boundary', () => {
    const summary = createCompactionSummaryMessage(
      { summary: 's', compactedCount: 1, keptCount: 1, tokenSpeed: 7 },
      55
    )
    expect(summary.isCompactionSummary).toBe(true)
    expect(summary.tokenSpeed).toBe(7)
  })

  it('places a later checkpoint inside the current context instead of recompacting hidden history', () => {
    const history = messages(12)
    history[4] = { ...history[4], isCompactionSummary: true }

    const result = applyCompactionResult({
      messages: history,
      result: { summary: 'next', compactedCount: 2, keptCount: 6 },
      now: 2000
    })

    expect(result.map((message) => message.id)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'compact-2000',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
      'm11'
    ])
  })
})
