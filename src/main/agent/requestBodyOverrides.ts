import { PROTECTED_MODEL_REQUEST_BODY_KEYS } from '../../shared/modelRequestBody'

const PROTECTED_REQUEST_BODY_KEYS = new Set<string>(PROTECTED_MODEL_REQUEST_BODY_KEYS)

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const cloneJsonValue = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue).filter((item) => item !== undefined)
  }
  if (!isPlainRecord(value)) return undefined
  return mergeRecords({}, value)
}

const mergeRecords = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) continue
    const existing = result[key]
    if (isPlainRecord(existing) && isPlainRecord(value)) {
      result[key] = mergeRecords(existing, value)
      continue
    }
    const cloned = cloneJsonValue(value)
    if (cloned !== undefined) result[key] = cloned
  }
  return result
}

/**
 * Merge custom per-model JSON fields into a generated protocol request. Core transport fields stay
 * host-owned so an override cannot desynchronize messages, tools, streaming, or privacy settings.
 */
export function applyModelRequestBodyOverrides(
  body: Record<string, unknown>,
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  if (!isPlainRecord(overrides)) return body
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(
      ([key]) => !PROTECTED_REQUEST_BODY_KEYS.has(key) && !UNSAFE_OBJECT_KEYS.has(key)
    )
  )
  return mergeRecords(body, safeOverrides)
}
