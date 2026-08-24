import { describe, expect, it } from 'vitest'
import { parseModelRequestBodyOverrides } from './modelRequestBody'

describe('model request body editor validation', () => {
  it('accepts a JSON object with provider-specific fields', () => {
    expect(
      parseModelRequestBodyOverrides('{"thinking":{"type":"enabled"},"max_tokens":48000}')
    ).toEqual({ thinking: { type: 'enabled' }, max_tokens: 48000 })
    expect(parseModelRequestBodyOverrides('  ')).toEqual({})
  })

  it('rejects non-object roots and protocol-owned fields', () => {
    expect(() => parseModelRequestBodyOverrides('[]')).toThrow('必须是一个 JSON 对象')
    expect(() => parseModelRequestBodyOverrides('{"model":"other","stream":false}')).toThrow(
      'model, stream'
    )
  })
})
