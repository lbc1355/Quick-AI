import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../shared/types'
import {
  buildVirtualMessageOffsets,
  findVirtualMessageIndex,
  findVirtualMessageRange,
  VIRTUAL_MESSAGE_GAP
} from './useVirtualizedMessages'

const makeMessages = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`
  }))

describe('useVirtualizedMessages pure helpers', () => {
  it('builds offsets using measured heights and gaps', () => {
    const messages = makeMessages(3)
    const measuredHeights = new Map([
      ['message-0', 100],
      ['message-1', 200]
    ])

    const result = buildVirtualMessageOffsets(messages, measuredHeights, 150)

    expect(result.offsets).toEqual([
      0,
      100 + VIRTUAL_MESSAGE_GAP,
      100 + VIRTUAL_MESSAGE_GAP + 200 + VIRTUAL_MESSAGE_GAP,
      100 + VIRTUAL_MESSAGE_GAP + 200 + VIRTUAL_MESSAGE_GAP + 150
    ])
    expect(result.totalHeight).toBe(result.offsets[result.offsets.length - 1])
  })

  it('finds an overscanned render window for the current viewport', () => {
    const messages = makeMessages(120)
    const { offsets } = buildVirtualMessageOffsets(messages, new Map(), 100)

    const range = findVirtualMessageRange(offsets, messages.length, 5000, 600)

    expect(range.startIndex).toBeGreaterThan(0)
    expect(range.endIndex).toBeGreaterThan(range.startIndex)
    expect(range.endIndex).toBeLessThan(messages.length)
  })

  it('finds the first visible message index without overscan', () => {
    const messages = makeMessages(10)
    const { offsets } = buildVirtualMessageOffsets(messages, new Map(), 100)

    expect(findVirtualMessageIndex(offsets, messages.length, 0)).toBe(0)
    expect(findVirtualMessageIndex(offsets, messages.length, 100 + VIRTUAL_MESSAGE_GAP + 1)).toBe(1)
  })
})
