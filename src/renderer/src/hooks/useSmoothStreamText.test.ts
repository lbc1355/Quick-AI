import { describe, expect, it } from 'vitest'
import { getSmoothStreamBatchSize, segmentGraphemes } from './useSmoothStreamText'

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
