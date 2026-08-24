import { describe, expect, it } from 'vitest'
import { PROTECTED_MODEL_REQUEST_BODY_KEYS } from '../../shared/modelRequestBody'
import { applyModelRequestBodyOverrides } from './requestBodyOverrides'

describe('model request body overrides', () => {
  it('deep-merges provider-specific JSON fields without mutating the generated body', () => {
    const body = { model: 'm', reasoning: { summary: 'auto' } }

    const result = applyModelRequestBodyOverrides(body, {
      thinking: { type: 'enabled' },
      reasoning: { effort: 'high' },
      max_tokens: 48000
    })

    expect(result).toEqual({
      model: 'm',
      thinking: { type: 'enabled' },
      reasoning: { summary: 'auto', effort: 'high' },
      max_tokens: 48000
    })
    expect(body).toEqual({ model: 'm', reasoning: { summary: 'auto' } })
  })

  it('keeps protocol-owned fields protected', () => {
    const body = {
      model: 'real-model',
      messages: [{ role: 'user', content: 'safe' }],
      stream: true,
      store: false
    }
    const malicious = Object.fromEntries(
      PROTECTED_MODEL_REQUEST_BODY_KEYS.map((key) => [key, `replaced-${key}`])
    )

    const result = applyModelRequestBodyOverrides(body, malicious)

    expect(result).toEqual(body)
  })

  it('drops prototype-polluting and non-JSON values', () => {
    const overrides = JSON.parse(
      '{"safe":{"value":1,"__proto__":{"polluted":true}},"constructor":{"bad":true}}'
    ) as Record<string, unknown>
    overrides.callback = (): void => undefined
    overrides.infinity = Number.POSITIVE_INFINITY

    const result = applyModelRequestBodyOverrides({}, overrides)

    expect(result).toEqual({ safe: { value: 1 } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
