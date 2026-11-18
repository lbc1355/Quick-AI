import { describe, expect, it } from 'vitest'
import { FetchUrlResult } from '../webTools'
import { buildFetchUrlModelResult } from './shared'
import { toWellFormedText } from '../../shared/unicodeText'

const makeResult = (overrides: Partial<FetchUrlResult> = {}): FetchUrlResult => ({
  url: 'https://example.test/page',
  finalUrl: 'https://example.test/page',
  title: 'Example',
  text: 'hello world',
  links: [],
  truncated: false,
  offset: 0,
  endOffset: 11,
  totalChars: 11,
  responseTruncated: false,
  rendered: false,
  ...overrides
})

describe('buildFetchUrlModelResult', () => {
  it('preserves emoji and keeps continuation offsets equal to the visible UTF-16 length', () => {
    const text = '🌟'.repeat(12000)
    const formatted = buildFetchUrlModelResult({
      result: makeResult({ text, endOffset: text.length, totalChars: text.length }),
      resourceId: 'resource-emoji',
      cacheCoverage: '',
      links: ''
    })
    const continuation = formatted.match(/fetch_url with \{"url":"[^"]+","offset":(\d+)\}/)
    const endOffset = Number(continuation?.[1])
    expect(endOffset).toBeGreaterThan(0)
    expect(endOffset % 2).toBe(0)
    expect(formatted).toBe(toWellFormedText(formatted))
    expect(formatted.endsWith(text.slice(0, endOffset))).toBe(true)
    expect(formatted.length).toBeLessThanOrEqual(20000)
  })

  it('keeps continuation offset aligned with the visible text when formatting must shrink output', () => {
    const text = 'x\n'.repeat(8000)
    const result = makeResult({
      text,
      endOffset: text.length,
      totalChars: text.length + 100,
      nextOffset: text.length
    })

    const formatted = buildFetchUrlModelResult({
      result,
      resourceId: 'resource-1',
      cacheCoverage: '',
      links: ''
    })

    expect(formatted.length).toBeLessThanOrEqual(20000)
    expect(formatted).toContain(`Content window: characters 0-${text.length}`)
    expect(formatted).toContain('Model-visible text: characters 0-')

    const continuation = formatted.match(/fetch_url with \{"url":"[^"]+","offset":(\d+)\}/)
    expect(continuation).not.toBeNull()
    expect(Number(continuation?.[1])).toBeGreaterThan(0)
    expect(Number(continuation?.[1])).toBeLessThan(text.length)
  })

  it('uses the original nextOffset when the whole fetched window is visible', () => {
    const result = makeResult({
      text: 'visible body',
      endOffset: 12,
      totalChars: 30,
      nextOffset: 12
    })

    const formatted = buildFetchUrlModelResult({
      result,
      resourceId: 'resource-1',
      cacheCoverage: '',
      links: ''
    })

    expect(formatted).toContain('offset":12')
    expect(formatted).not.toContain('Model-visible text:')
  })
})
