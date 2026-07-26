import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../shared/types'
import {
  applyCompactionResult,
  canCompactMessages,
  COMPACTION_PLACEHOLDER_ID,
  createCompactionPlaceholder,
  createCompactionSummaryMessage,
  formatCompactionSummaryMessage,
  MANUAL_COMPACTION_KEEP_RECENT_MESSAGES,
  withoutCompactionPlaceholder
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
})

describe('compaction placeholder', () => {
  it('renders a running step so the bubble shows progress while the model works', () => {
    const placeholder = createCompactionPlaceholder()
    expect(placeholder.id).toBe(COMPACTION_PLACEHOLDER_ID)
    expect(placeholder.agentEvents?.[0]).toMatchObject({ type: 'agent_step', status: 'running' })
  })

  it('is stripped without touching real messages', () => {
    const withPlaceholder = [...messages(2), createCompactionPlaceholder()]
    expect(withoutCompactionPlaceholder(withPlaceholder).map((m) => m.id)).toEqual(['m0', 'm1'])
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
      messages: [...messages(5), createCompactionPlaceholder()],
      result: { summary: 's', compactedCount: 3, keptCount: 2 },
      now: 1000
    })

    expect(result.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'compact-1000', 'm3', 'm4'])
  })

  it('removes the placeholder before slicing so the split lands on real messages', () => {
    const result = applyCompactionResult({
      // A placeholder ahead of the boundary would shift every index if it survived.
      messages: [createCompactionPlaceholder(), ...messages(4)],
      result: { summary: 's', compactedCount: 2, keptCount: 2 },
      now: 1
    })

    expect(result.map((m) => m.id)).toEqual(['m0', 'm1', 'compact-1', 'm2', 'm3'])
    expect(result.some((m) => m.id === COMPACTION_PLACEHOLDER_ID)).toBe(false)
  })

  it('keeps the compacted messages so the user can still scroll back through them', () => {
    const result = applyCompactionResult({
      messages: messages(6),
      result: { summary: 's', compactedCount: 4, keptCount: 2 },
      now: 1
    })
    expect(result).toHaveLength(7)
  })

  it('marks the summary so context cropping can find the boundary', () => {
    const summary = createCompactionSummaryMessage(
      { summary: 's', compactedCount: 1, keptCount: 1, tokenSpeed: 7 },
      55
    )
    expect(summary.isCompactionSummary).toBe(true)
    expect(summary.tokenSpeed).toBe(7)
  })
})
