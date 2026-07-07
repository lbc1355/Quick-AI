export type RuntimeErrorSource = 'model_api' | 'mcp' | 'agent' | 'renderer' | 'unknown'
export type RuntimeErrorCategory =
  | 'timeout'
  | 'rate_limit'
  | 'unauthorized'
  | 'network'
  | 'system'
  | 'unknown'

export interface RuntimeErrorPayload {
  message: string
  category: RuntimeErrorCategory
  source: RuntimeErrorSource
  rawError?: string
  timestamp: number
}

export function isRuntimeErrorPayload(value: unknown): value is RuntimeErrorPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.message === 'string' &&
    typeof p.timestamp === 'number' &&
    (p.category === 'timeout' ||
      p.category === 'rate_limit' ||
      p.category === 'unauthorized' ||
      p.category === 'network' ||
      p.category === 'system' ||
      p.category === 'unknown') &&
    (p.source === 'model_api' ||
      p.source === 'mcp' ||
      p.source === 'agent' ||
      p.source === 'renderer' ||
      p.source === 'unknown')
  )
}

export function classifyRuntimeError(errorText: string): { category: RuntimeErrorCategory } {
  const lowercaseErr = errorText.toLowerCase()

  if (lowercaseErr.includes('terminated')) {
    return { category: 'timeout' }
  }

  if (lowercaseErr.includes('rate limit') || lowercaseErr.includes('429')) {
    return { category: 'rate_limit' }
  }

  if (
    lowercaseErr.includes('unauthorized') ||
    lowercaseErr.includes('401') ||
    lowercaseErr.includes('api key') ||
    lowercaseErr.includes('key is invalid')
  ) {
    return { category: 'unauthorized' }
  }

  if (
    lowercaseErr.includes('dns') ||
    lowercaseErr.includes('fetch failed') ||
    lowercaseErr.includes('connect') ||
    lowercaseErr.includes('network error') ||
    lowercaseErr.includes('enoent')
  ) {
    return { category: 'network' }
  }

  return { category: 'unknown' }
}

export function normalizeRuntimeError(
  error: unknown,
  source: RuntimeErrorSource = 'unknown'
): RuntimeErrorPayload {
  if (isRuntimeErrorPayload(error)) {
    return error
  }

  let message = 'Unknown error'
  let rawError: string | undefined = undefined

  if (error instanceof Error) {
    message = error.message
    rawError = error.stack || error.toString()
  } else if (typeof error === 'string') {
    message = error
  } else if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>
    message = typeof errObj.message === 'string' ? errObj.message : String(error)
    rawError = JSON.stringify(error)
  }

  const { category } = classifyRuntimeError(message)

  return {
    message,
    category,
    source,
    rawError,
    timestamp: Date.now()
  }
}
