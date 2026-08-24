import { describe, expect, it } from 'vitest'
import { createHttpModelTransportError } from './modelTransportError'

const response = (status: number, headers: Record<string, string> = {}): Response =>
  ({
    status,
    statusText: '',
    headers: new Headers(headers)
  }) as Response

describe('model transport errors', () => {
  it('normalizes request ids and Retry-After for rate limits', () => {
    const error = createHttpModelTransportError(
      response(429, { 'retry-after': '2', 'x-request-id': 'req-123' }),
      'rate limit reached'
    )

    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      requestId: 'req-123',
      retryAfterMs: 2000,
      retryable: true
    })
  })

  it('distinguishes context overflow and exhausted quota from transient failures', () => {
    expect(
      createHttpModelTransportError(response(400), 'maximum context length exceeded')
    ).toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED', retryable: false })
    expect(createHttpModelTransportError(response(429), 'insufficient_quota')).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      retryable: false
    })
  })
})
