import { toWellFormedText } from '../../shared/unicodeText'

/**
 * JSON.stringify escapes lone surrogates but does not repair them: strict UTF-8 gateways fail
 * after parsing that JSON. Normalize every string at the wire boundary, including object keys,
 * without changing persisted history, tool results, or the bytes of already-valid requests.
 */
export function serializeModelRequest(body: Record<string, unknown>): string {
  return JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value === 'string') return toWellFormedText(value)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value)
      if (entries.some(([key]) => toWellFormedText(key) !== key)) {
        return Object.fromEntries(entries.map(([key, item]) => [toWellFormedText(key), item]))
      }
    }
    return value
  })
}
