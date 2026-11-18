import { describe, expect, it } from 'vitest'
import { isPrivateIPv4, isPrivateIPv6, normalizeFetchUrlOptions } from './urlSafety'

describe('normalizeFetchUrlOptions', () => {
  it('defaults to the first fetch window', () => {
    expect(normalizeFetchUrlOptions()).toEqual({ offset: 0, maxChars: 10000 })
  })

  it('clamps offset and maxChars to safe page-window bounds', () => {
    for (const offset of [-1, -50]) {
      expect(normalizeFetchUrlOptions({ offset, maxChars: 100 })).toEqual({
        offset: 0,
        maxChars: 1000
      })
    }
    expect(normalizeFetchUrlOptions({ offset: 42.9, maxChars: 25000 })).toEqual({
      offset: 42,
      maxChars: 16000
    })
  })
})

describe('isPrivateIPv4 (SSRF guard)', () => {
  it('flags private / reserved ranges', () => {
    for (const ip of [
      '10.0.0.1',
      '192.168.1.10',
      '127.0.0.1',
      '172.16.5.4',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0'
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIPv4(ip)).toBe(false)
    }
  })

  it('treats malformed input as private (fail closed)', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true)
    expect(isPrivateIPv4('1.2.3')).toBe(true)
  })
})

describe('isPrivateIPv6 (SSRF guard)', () => {
  it('flags loopback and unique-local / link-local ranges', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIPv6(ip)).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false)
  })
})
