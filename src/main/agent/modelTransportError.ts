export type ModelTransportErrorCode =
  | 'ABORTED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTHENTICATION'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'SERVER_ERROR'
  | 'STREAM_PROTOCOL_ERROR'
  | 'UNKNOWN'

export interface ModelTransportErrorOptions {
  status?: number
  requestId?: string
  retryAfterMs?: number
  retryable?: boolean
  cause?: unknown
}

/** Stable error shape shared by provider transports, retry policy, logs, and future UI handling. */
export class ModelTransportError extends Error {
  readonly code: ModelTransportErrorCode
  readonly status?: number
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly retryable: boolean

  constructor(
    code: ModelTransportErrorCode,
    message: string,
    options: ModelTransportErrorOptions = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ModelTransportError'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
    this.retryAfterMs = options.retryAfterMs
    this.retryable = options.retryable ?? false
  }
}

const getHeader = (response: Response, names: string[]): string | undefined => {
  for (const name of names) {
    const value = response.headers?.get?.(name)?.trim()
    if (value) return value
  }
  return undefined
}

const parseRetryAfterMs = (value: string | undefined, now = Date.now()): number | undefined => {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined
}

const isContextWindowError = (detail: string): boolean =>
  /(context window|context length|maximum context|max(?:imum)? tokens|too many tokens|token limit)/i.test(
    detail
  )

const isQuotaError = (detail: string): boolean =>
  /(insufficient[_ ]quota|quota exceeded|billing|credit balance)/i.test(detail)

const classifyHttpError = (
  status: number,
  detail: string
): { code: ModelTransportErrorCode; retryable: boolean } => {
  if (status === 401) return { code: 'AUTHENTICATION', retryable: false }
  if (status === 403) return { code: 'PERMISSION_DENIED', retryable: false }
  if (status === 408) return { code: 'TIMEOUT', retryable: true }
  if (status === 429) {
    return isQuotaError(detail)
      ? { code: 'QUOTA_EXCEEDED', retryable: false }
      : { code: 'RATE_LIMITED', retryable: true }
  }
  if (isContextWindowError(detail)) {
    return { code: 'CONTEXT_WINDOW_EXCEEDED', retryable: false }
  }
  if (status >= 500) return { code: 'SERVER_ERROR', retryable: true }
  if (status >= 400) return { code: 'INVALID_REQUEST', retryable: false }
  return { code: 'UNKNOWN', retryable: false }
}

export function createHttpModelTransportError(
  response: Response,
  detail: string,
  message = `API Error: ${response.status} - ${detail}`
): ModelTransportError {
  const classification = classifyHttpError(response.status, detail)
  return new ModelTransportError(classification.code, message, {
    status: response.status,
    requestId: getHeader(response, ['x-request-id', 'request-id', 'x-amzn-requestid', 'cf-ray']),
    retryAfterMs: parseRetryAfterMs(getHeader(response, ['retry-after'])),
    retryable: classification.retryable
  })
}

export const createAbortedModelTransportError = (cause?: unknown): ModelTransportError =>
  new ModelTransportError('ABORTED', 'Agent execution aborted by user.', {
    retryable: false,
    cause
  })

export const createTimeoutModelTransportError = (
  idleTimeoutMs: number,
  phase: string,
  cause?: unknown
): ModelTransportError =>
  new ModelTransportError('TIMEOUT', `${phase} idle timeout after ${idleTimeoutMs}ms`, {
    retryable: true,
    cause
  })

export const createNetworkModelTransportError = (cause: unknown): ModelTransportError => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ModelTransportError('NETWORK', message || 'Provider network error', {
    retryable: true,
    cause
  })
}

export const createStreamProtocolError = (transportName: string): ModelTransportError =>
  new ModelTransportError(
    'STREAM_PROTOCOL_ERROR',
    `${transportName} stream ended before an explicit completion marker`,
    { retryable: true }
  )

export const isModelTransportError = (error: unknown): error is ModelTransportError =>
  error instanceof ModelTransportError
