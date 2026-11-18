import { describe, expect, it } from 'vitest'
import { serializeModelRequest } from './serializeModelRequest'

describe('serializeModelRequest', () => {
  it('repairs nested values and schema keys without mutating the source', () => {
    const body = {
      messages: [{ content: 'history \ud83c', reasoning_content: 'reasoning \udfff' }],
      tools: [{ description: 'tool \ud83c', parameters: { properties: { ['key\ud83c']: {} } } }],
      metadata: { note: 'custom field \udfff' }
    }
    const encoded = serializeModelRequest(body)
    const decoded = JSON.parse(encoded)
    expect(decoded.messages[0]).toEqual({ content: 'history �', reasoning_content: 'reasoning �' })
    expect(decoded.tools[0]).toEqual({
      description: 'tool �',
      parameters: { properties: { 'key�': {} } }
    })
    expect(decoded.metadata.note).toBe('custom field �')
    expect(body.messages[0].content).toBe('history \ud83c')
    expect(encoded).not.toMatch(/\\u(?:d83c|dfff)/i)
  })

  it('keeps valid request bytes identical for prompt cache reuse', () => {
    const body = {
      model: 'test',
      messages: [{ content: '中文 🌟 👩‍💻 \\ud83c' }],
      tools: [{ parameters: { properties: { '🌟': { type: 'string' } } } }],
      stream: true,
      optional: undefined
    }
    expect(serializeModelRequest(body)).toBe(JSON.stringify(body))
  })
})
