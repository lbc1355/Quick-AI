import { describe, expect, it } from 'vitest'
import { sliceUtf8Prefix, sliceUtf8Suffix, utf8ByteLength } from './utf8Text'

describe('UTF-8 text budgets', () => {
  it('counts ASCII, CJK, and emoji by encoded bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('中文')).toBe(6)
    expect(utf8ByteLength('🙂')).toBe(4)
  })

  it('slices prefixes without splitting multibyte code points', () => {
    expect(sliceUtf8Prefix('a中🙂b', 4)).toMatchObject({
      text: 'a中',
      endOffset: 2,
      bytes: 4
    })
    expect(sliceUtf8Prefix('a中🙂b', 7)).toMatchObject({
      text: 'a中',
      endOffset: 2,
      bytes: 4
    })
    expect(sliceUtf8Prefix('a中🙂b', 8)).toMatchObject({
      text: 'a中🙂',
      endOffset: 4,
      bytes: 8
    })
  })

  it('slices suffixes without splitting multibyte code points', () => {
    expect(sliceUtf8Suffix('a中🙂b', 5)).toMatchObject({
      text: '🙂b',
      startOffset: 2,
      bytes: 5
    })
    expect(sliceUtf8Suffix('a中🙂b', 4)).toMatchObject({
      text: 'b',
      startOffset: 4,
      bytes: 1
    })
  })
})
