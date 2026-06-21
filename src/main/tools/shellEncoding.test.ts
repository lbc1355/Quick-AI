import { describe, expect, it } from 'vitest'
import { decodeShellOutputForDisplay } from './shellEncoding'

describe('shellEncoding', () => {
  it('decodes utf8 shell output without replacement characters', () => {
    expect(decodeShellOutputForDisplay(Buffer.from('hello', 'utf8'), 'utf-8')).toBe('hello')
  })

  it('uses fallback encoding when utf8 decoding has replacement characters', () => {
    const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])

    expect(decodeShellOutputForDisplay(gbkBytes, 'gbk')).toBe('中文')
  })
})
