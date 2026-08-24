/** Protocol-owned fields that custom per-model request JSON must not replace. */
export const PROTECTED_MODEL_REQUEST_BODY_KEYS = [
  'model',
  'messages',
  'input',
  'instructions',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
  'store'
] as const

export const findProtectedModelRequestBodyKeys = (value: Record<string, unknown>): string[] => {
  const protectedKeys = new Set<string>(PROTECTED_MODEL_REQUEST_BODY_KEYS)
  return Object.keys(value).filter((key) => protectedKeys.has(key))
}

export const parseModelRequestBodyOverrides = (text: string): Record<string, unknown> => {
  const source = text.trim()
  if (!source) return {}

  const parsed = JSON.parse(source) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体附加参数必须是一个 JSON 对象。')
  }
  const overrides = parsed as Record<string, unknown>
  const protectedKeys = findProtectedModelRequestBodyKeys(overrides)
  if (protectedKeys.length > 0) {
    throw new Error(`以下字段由 QuickAI 管理，不能覆盖：${protectedKeys.join(', ')}`)
  }
  return overrides
}
