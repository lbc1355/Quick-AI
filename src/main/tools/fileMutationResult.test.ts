import { describe, expect, it } from 'vitest'
import {
  buildShortUnifiedDiff,
  formatEditLookupFailure,
  formatOccurrenceContexts
} from './fileMutationResult'

describe('file mutation result helpers', () => {
  it('formats lookup failures with file size and retry guidance', () => {
    const result = formatEditLookupFailure(
      ['function target() {', '  return 42', '}'].join('\n'),
      'return fortyTwo'
    )

    expect(result).toContain('Target preview: return fortyTwo')
    expect(result).toContain('Target length: 15 chars across 1 line(s).')
    expect(result).toContain('File length: 3 line(s).')
    expect(result).toContain('Tip: call file_read')
  })

  it('formats ambiguous occurrence locations with nearby source context', () => {
    const content = ['const value = 1', 'same', 'const value = 2', 'same'].join('\n')
    const first = content.indexOf('same')
    const second = content.lastIndexOf('same')

    const result = formatOccurrenceContexts(content, 'same', [first, second])

    expect(result).toContain('Match 1: lines 2-2')
    expect(result).toContain('> 2 | same')
    expect(result).toContain('Match 2: lines 4-4')
    expect(result).toContain('> 4 | same')
  })

  it('returns compact unified diffs and truncates oversized output', () => {
    const diff = buildShortUnifiedDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(diff).toContain('- two')
    expect(diff).toContain('+ TWO')

    const truncated = buildShortUnifiedDiff('one\ntwo\nthree', 'one\nTWO\nthree', 8)
    expect(truncated).toContain('[Diff truncated.')
  })
})
