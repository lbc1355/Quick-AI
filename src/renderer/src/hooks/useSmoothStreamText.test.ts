import { describe, expect, it } from 'vitest'
import {
  getNextShownLength,
  getSmoothStreamBatchSize,
  segmentGraphemes
} from './useSmoothStreamText'

describe('useSmoothStreamText helpers', () => {
  it('segments text into display-safe graphemes', () => {
    expect(segmentGraphemes('abc')).toEqual(['a', 'b', 'c'])
    expect(segmentGraphemes('你好')).toEqual(['你', '好'])
  })

  it('increases the per-frame batch size when the queue is long', () => {
    expect(getSmoothStreamBatchSize(5)).toBe(3)
    expect(getSmoothStreamBatchSize(100)).toBeGreaterThan(getSmoothStreamBatchSize(24))
    expect(getSmoothStreamBatchSize(900)).toBeGreaterThan(getSmoothStreamBatchSize(400))
  })
})

describe('getNextShownLength', () => {
  it('returns 0 when the target is empty', () => {
    expect(getNextShownLength(5, 0)).toBe(0)
  })

  it('stays at the target once it is fully shown', () => {
    expect(getNextShownLength(10, 10)).toBe(10)
    expect(getNextShownLength(12, 10)).toBe(10)
  })

  it('advances a short target one batch at a time (typewriter feel)', () => {
    expect(getNextShownLength(0, 5)).toBe(3)
    expect(getNextShownLength(3, 5)).toBe(5)
  })

  it('uses larger batches to catch up on long targets', () => {
    expect(getNextShownLength(0, 100)).toBe(18)
    expect(getNextShownLength(0, 500)).toBe(56)
    expect(getNextShownLength(0, 900)).toBe(96)
  })

  it('never overshoots the target length', () => {
    expect(getNextShownLength(99, 100)).toBe(100) // 99 + batch(3) would be 102 → clamped
    expect(getNextShownLength(98, 100)).toBe(100)
    expect(getNextShownLength(0, 3)).toBe(3)
  })
})
