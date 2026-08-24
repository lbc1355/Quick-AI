import type { ResolvedProviderStreamPolicy } from '../../shared/types'
import {
  createAbortedModelTransportError,
  createNetworkModelTransportError,
  createStreamProtocolError,
  createTimeoutModelTransportError,
  isModelTransportError
} from './modelTransportError'

type AbortKind = 'caller' | 'timeout'

/**
 * One request-scoped abort signal with a timer around each outstanding provider operation.
 * Processing already-received chunks does not consume the idle budget.
 */
export class ModelStreamScope {
  private readonly controller = new AbortController()
  private abortKind?: AbortKind
  private readonly onCallerAbort?: () => void

  constructor(
    private readonly policy: ResolvedProviderStreamPolicy,
    private readonly callerSignal?: AbortSignal
  ) {
    if (callerSignal?.aborted) {
      this.abortKind = 'caller'
      this.controller.abort(callerSignal.reason)
      return
    }
    if (callerSignal) {
      this.onCallerAbort = () => {
        if (this.abortKind) return
        this.abortKind = 'caller'
        this.controller.abort(callerSignal.reason)
      }
      callerSignal.addEventListener('abort', this.onCallerAbort, { once: true })
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  async waitFor<T>(operation: () => Promise<T>, phase: string): Promise<T> {
    if (this.abortKind === 'caller' || this.callerSignal?.aborted) {
      throw createAbortedModelTransportError(this.callerSignal?.reason)
    }
    if (this.abortKind === 'timeout') {
      throw createTimeoutModelTransportError(this.policy.idleTimeoutMs, phase)
    }

    let timer: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(
          this.abortKind === 'timeout'
            ? createTimeoutModelTransportError(this.policy.idleTimeoutMs, phase)
            : createAbortedModelTransportError(this.callerSignal?.reason)
        )
      }
      this.controller.signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        if (this.abortKind) return
        this.abortKind = 'timeout'
        this.controller.abort()
      }, this.policy.idleTimeoutMs)
    })

    try {
      return await Promise.race([operation(), interrupted])
    } catch (error) {
      if (isModelTransportError(error)) throw error
      if (this.abortKind === 'caller' || this.callerSignal?.aborted) {
        throw createAbortedModelTransportError(error)
      }
      if (this.abortKind === 'timeout') {
        throw createTimeoutModelTransportError(this.policy.idleTimeoutMs, phase, error)
      }
      throw createNetworkModelTransportError(error)
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) this.controller.signal.removeEventListener('abort', onAbort)
    }
  }

  assertCompleted(explicitlyCompleted: boolean, transportName: string): void {
    if (this.policy.completionMode === 'require-explicit' && !explicitlyCompleted) {
      throw createStreamProtocolError(transportName)
    }
  }

  dispose(): void {
    if (this.callerSignal && this.onCallerAbort) {
      this.callerSignal.removeEventListener('abort', this.onCallerAbort)
    }
  }
}
