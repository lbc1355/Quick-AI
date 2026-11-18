import { describe, expect, it } from 'vitest'
import { sliceUnicode, toWellFormedText } from './unicodeText'

describe('Unicode text boundaries', () => {
  it('excludes a split code point at either boundary while retaining UTF-16 slice semantics', () => {
    expect(sliceUnicode('a🌟b', 0, 2)).toBe('a')
    expect(sliceUnicode('a🌟b', 2)).toBe('b')
    expect(sliceUnicode('a🌟b', 1, 3)).toBe('🌟')
    expect(sliceUnicode('a🌟b', -3, -1)).toBe('🌟')
    expect(sliceUnicode('a🌟b', -2)).toBe('b')
    expect(sliceUnicode('a🌟b', 1, 2)).toBe('')
    expect(sliceUnicode('a🌟b', 2, 3)).toBe('')
    expect(sliceUnicode('abc', 2, 1)).toBe('')
  })

  it('preserves intact multilingual text, emoji sequences, and literal escape text', () => {
    const text = '中文 e\u0301 🌟 👩‍💻 🏳️‍🌈 \\ud83c'
    expect(toWellFormedText(text)).toBe(text)
    expect(sliceUnicode(text)).toBe(text)
  })

  it('replaces lone high and low surrogates without changing valid pairs beside them', () => {
    expect(toWellFormedText('\ud83cA\udfff🌟\ud83c🌟\udfff')).toBe('�A�🌟�🌟�')
    expect(toWellFormedText('\ud83c\ud83c\udf1f\udf1f')).toBe('�🌟�')
  })
})
