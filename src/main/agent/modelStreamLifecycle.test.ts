import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelStreamScope } from './modelStreamLifecycle'

describe('ModelStreamScope', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('times out one outstanding provider read without counting completed work', async () => {
    vi.useFakeTimers()
    const scope = new ModelStreamScope({ completionMode: 'allow-eof', idleTimeoutMs: 25 })

    await expect(scope.waitFor(async () => 'chunk', 'Provider stream')).resolves.toBe('chunk')
    const pending = scope.waitFor(() => new Promise<never>(() => undefined), 'Provider stream')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true })

    await vi.advanceTimersByTimeAsync(25)
    await rejected
    scope.dispose()
  })

  it('routes caller cancellation separately from an idle timeout', async () => {
    const controller = new AbortController()
    const scope = new ModelStreamScope(
      { completionMode: 'allow-eof', idleTimeoutMs: 300000 },
      controller.signal
    )
    const pending = scope.waitFor(() => new Promise<never>(() => undefined), 'Provider stream')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED', retryable: false })

    controller.abort()
    await rejected
    scope.dispose()
  })

  it('enforces explicit completion only for strict provider policies', () => {
    const permissive = new ModelStreamScope({ completionMode: 'allow-eof', idleTimeoutMs: 1000 })
    const strict = new ModelStreamScope({ completionMode: 'require-explicit', idleTimeoutMs: 1000 })

    expect(() => permissive.assertCompleted(false, 'Custom')).not.toThrow()
    expect(() => strict.assertCompleted(false, 'DeepSeek')).toThrow(
      'stream ended before an explicit completion marker'
    )
    expect(() => strict.assertCompleted(true, 'DeepSeek')).not.toThrow()
    permissive.dispose()
    strict.dispose()
  })
})
