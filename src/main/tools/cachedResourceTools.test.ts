import { describe, expect, it } from 'vitest'
import {
  projectCachedResourceLineWindow,
  projectCachedResourceReadWindow
} from './cachedResourceTools'

const makeChunk = (
  overrides: Partial<Parameters<typeof projectCachedResourceReadWindow>[0]> = {}
): Parameters<typeof projectCachedResourceReadWindow>[0] => ({
  text: '0123456789abcdef',
  offset: 0,
  endOffset: 16,
  requestedOffset: 0,
  ...overrides
})

describe('projectCachedResourceReadWindow', () => {
  it('returns the full cached chunk when maxChars is omitted', () => {
    const window = projectCachedResourceReadWindow(makeChunk({ requestedOffset: 4 }))

    expect(window.offset).toBe(0)
    expect(window.endOffset).toBe(16)
    expect(window.nextOffset).toBeUndefined()
    expect(window.text).toBe('0123456789abcdef')
  })

  it('limits the returned text when maxChars is provided', () => {
    const window = projectCachedResourceReadWindow(makeChunk(), 8)

    expect(window.offset).toBe(0)
    expect(window.endOffset).toBe(8)
    expect(window.nextOffset).toBe(8)
    expect(window.text).toBe('01234567')
    expect(window.warning).toContain('maxChars=8')
  })

  it('starts from the requested offset inside a cached chunk when maxChars is provided', () => {
    const window = projectCachedResourceReadWindow(makeChunk({ requestedOffset: 6 }), 5)

    expect(window.offset).toBe(6)
    expect(window.endOffset).toBe(11)
    expect(window.nextOffset).toBe(11)
    expect(window.text).toBe('6789a')
  })

  it('keeps emoji intact at a truncation boundary and returns a resumable offset', () => {
    const chunk = makeChunk({ text: 'a🌟b', endOffset: 4 })
    const first = projectCachedResourceReadWindow(chunk, 2)
    expect(first).toMatchObject({ text: 'a', offset: 0, endOffset: 1, nextOffset: 1 })
    const next = projectCachedResourceReadWindow(
      { ...chunk, requestedOffset: first.nextOffset! },
      4
    )
    expect(next).toMatchObject({ text: '🌟b', offset: 1, endOffset: 4 })
    expect(first.text + next.text).toBe(chunk.text)
  })

  it('reports the actual start when a requested offset splits an emoji', () => {
    const window = projectCachedResourceReadWindow(
      makeChunk({ text: 'a🌟b', endOffset: 4, requestedOffset: 2 }),
      4
    )
    expect(window).toMatchObject({ text: 'b', offset: 3, endOffset: 4 })
  })

  it('reads an inclusive line range with line numbers', () => {
    const window = projectCachedResourceLineWindow('one\ntwo\nthree\nfour', {
      lineStart: 2,
      lineEnd: 3
    })

    expect(window).toMatchObject({ lineStart: 2, lineEnd: 3, totalLines: 4 })
    expect(window.text).toContain('     2  two')
    expect(window.text).toContain('     3  three')
  })

  it('reads the requested number of lines from the tail', () => {
    const window = projectCachedResourceLineWindow('one\ntwo\nthree\nfour', { tailLines: 2 })

    expect(window).toMatchObject({ lineStart: 3, lineEnd: 4, totalLines: 4 })
    expect(window.text).not.toContain('two')
    expect(window.text).toContain('three')
    expect(window.text).toContain('four')
  })
})
