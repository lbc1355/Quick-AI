import { describe, expect, it } from 'vitest'
import { isPrivateIPv4, isPrivateIPv6, normalizeFetchUrlOptions } from './urlSafety'

describe('urlSafety', () => {
  it('normalizes fetch page-window options', () => {
    expect(normalizeFetchUrlOptions({ offset: -1, maxChars: 100 })).toEqual({
      offset: 0,
      maxChars: 1000
    })
    expect(normalizeFetchUrlOptions({ offset: 42.9, maxChars: 25000 })).toEqual({
      offset: 42,
      maxChars: 16000
    })
  })

  it('flags private IPv4 and IPv6 addresses', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
    expect(isPrivateIPv6('::1')).toBe(true)
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false)
  })
})
