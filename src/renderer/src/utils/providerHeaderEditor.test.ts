import { describe, expect, it } from 'vitest'
import {
  isValidProviderAuthHeader,
  providerHeaderItemsToRecord,
  providerHeadersToItems
} from './providerHeaderEditor'

describe('providerHeaderEditor', () => {
  it('round-trips structured custom headers', () => {
    const items = providerHeadersToItems({ 'X-Client': 'quick-ai', 'X-Region': 'cn' })

    expect(providerHeaderItemsToRecord(items)).toEqual({
      headers: { 'X-Client': 'quick-ai', 'X-Region': 'cn' }
    })
  })

  it('rejects duplicate names case-insensitively', () => {
    expect(
      providerHeaderItemsToRecord([
        { id: '1', name: 'X-Test', value: 'a' },
        { id: '2', name: 'x-test', value: 'b' }
      ])
    ).toEqual({ error: 'Header 重复：x-test' })
  })

  it('rejects invalid names and newline injection', () => {
    expect(isValidProviderAuthHeader('api key')).toBe(false)
    expect(
      providerHeaderItemsToRecord([{ id: '1', name: 'X-Test', value: 'ok\r\nInjected: yes' }])
    ).toEqual({ error: 'Header X-Test 的值不能包含换行。' })
  })
})
