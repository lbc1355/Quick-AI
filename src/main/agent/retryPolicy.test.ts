import { describe, it, expect, vi } from 'vitest'
import { withRetry, DEFAULT_RETRY_POLICY } from './retryPolicy'

describe('withRetry', () => {
  it('retries a retryable error up to maxRetries with exponential backoff', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw new TypeError('fetch failed')
      return 'ok'
    })

    const promise = withRetry(fn, DEFAULT_RETRY_POLICY)
    await vi.advanceTimersByTimeAsync(1000) // 1st backoff (baseDelayMs)
    await vi.advanceTimersByTimeAsync(2000) // 2nd backoff (2x)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('does not retry a non-retryable error', async () => {
    const fn = vi.fn(async () => {
      throw new Error('API Error: 401 - invalid api key')
    })
    await expect(withRetry(fn, DEFAULT_RETRY_POLICY)).rejects.toThrow('API Error')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn(async () => 'never')
    await expect(withRetry(fn, DEFAULT_RETRY_POLICY, controller.signal)).rejects.toThrow('aborted')
    expect(fn).not.toHaveBeenCalled()
  })

  it('honors an extra canRetry gate that suppresses a policy-eligible retry', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const canRetry = vi.fn(() => false)
    await expect(withRetry(fn, DEFAULT_RETRY_POLICY, undefined, canRetry)).rejects.toThrow(
      'fetch failed'
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(canRetry).toHaveBeenCalledTimes(1)
  })

  it('passes the failing error and attempt index to canRetry', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 2) throw new TypeError('fetch failed')
      return 'ok'
    })
    const attempts: number[] = []
    const errors: Error[] = []
    const promise = withRetry(fn, DEFAULT_RETRY_POLICY, undefined, (error, attempt) => {
      errors.push(error)
      attempts.push(attempt)
      return true
    })

    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBe('ok')
    expect(attempts).toEqual([0])
    expect(errors[0]).toBeInstanceOf(TypeError)
    vi.useRealTimers()
  })
})
