import { UserChoiceResponse } from '../../shared/types'

interface PendingUserChoicePromise {
  resolve: (response: UserChoiceResponse) => void
  reject: (err: Error) => void
  timeoutId: NodeJS.Timeout
  abortHandler?: () => void
  signal?: AbortSignal
}

export class UserChoiceManager {
  private pending = new Map<string, PendingUserChoicePromise>()

  async requestChoice(
    reqId: string,
    requestId: string,
    signal: AbortSignal,
    timeoutMs = 10 * 60 * 1000
  ): Promise<UserChoiceResponse> {
    const key = `${reqId}:${requestId}`
    if (signal.aborted) {
      throw new Error('User choice request aborted.')
    }

    return new Promise<UserChoiceResponse>((resolve, reject) => {
      const cleanup = (): void => {
        const pending = this.pending.get(key)
        if (!pending) return
        clearTimeout(pending.timeoutId)
        if (pending.signal && pending.abortHandler) {
          pending.signal.removeEventListener('abort', pending.abortHandler)
        }
        this.pending.delete(key)
      }

      const timeoutId = setTimeout(() => {
        cleanup()
        reject(
          new Error(`User choice request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`)
        )
      }, timeoutMs)

      const abortHandler = (): void => {
        cleanup()
        reject(new Error('User choice request aborted.'))
      }

      signal.addEventListener('abort', abortHandler, { once: true })
      this.pending.set(key, { resolve, reject, timeoutId, abortHandler, signal })
    })
  }

  resolve(reqId: string, requestId: string, response: UserChoiceResponse): void {
    const key = `${reqId}:${requestId}`
    const pending = this.pending.get(key)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler)
    }
    this.pending.delete(key)
    pending.resolve(response)
  }

  cleanupForRun(reqId: string): void {
    const prefix = `${reqId}:`
    for (const [key, pending] of this.pending.entries()) {
      if (!key.startsWith(prefix)) continue
      clearTimeout(pending.timeoutId)
      if (pending.signal && pending.abortHandler) {
        pending.signal.removeEventListener('abort', pending.abortHandler)
      }
      this.pending.delete(key)
      pending.reject(new Error('Agent run terminated or aborted.'))
    }
  }
}

export const globalUserChoiceManager = new UserChoiceManager()
