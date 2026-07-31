export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryableErrors: Set<string> // Set of lowercase error message substrings that are retryable
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  retryableErrors: new Set([
    'etimedout',
    'econnreset',
    'econnrefused',
    'und_err_connect_timeout',
    'fetch failed',
    'network error'
  ])
}

export function isRetryableError(error: Error, policy: RetryPolicy): boolean {
  const message = error.message.toLowerCase()
  for (const pattern of policy.retryableErrors) {
    if (message.includes(pattern)) return true
  }
  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal,
  /** Optional extra gate: return false to suppress a retry that the policy would otherwise allow. */
  canRetry?: (error: Error, attempt: number) => boolean
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw new Error('Agent execution aborted by user.')
      return await fn()
    } catch (error) {
      lastError = error as Error
      const extraRetryable = canRetry ? canRetry(lastError, attempt) : true
      if (
        attempt < policy.maxRetries &&
        isRetryableError(lastError, policy) &&
        extraRetryable &&
        !signal?.aborted
      ) {
        const delay = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs)
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', onAbort)
            reject(new Error('Agent execution aborted by user.'))
          }
          if (signal?.aborted) {
            return reject(new Error('Agent execution aborted by user.'))
          }
          const timeoutId = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, delay)
          signal?.addEventListener('abort', onAbort)
        })
        continue
      }
      throw lastError
    }
  }
  throw lastError || new Error('Unknown retry failure')
}
