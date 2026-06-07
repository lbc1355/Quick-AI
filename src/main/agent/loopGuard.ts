/**
 * LoopGuard — behavioural guardrails that stop an agent run from spinning on
 * unproductive work, independent of the hard `maxSteps` ceiling.
 *
 * Two distinct protections (modelled on CodeWhale's loop_guard):
 *   1. Identical-call blocking — the same tool invoked with the same arguments
 *      too many times in a run is almost always a loop; block it and tell the
 *      model to use the existing result or change approach.
 *   2. Consecutive-failure escalation — a tool that keeps throwing should first
 *      warn the model, then halt the turn so we surface a best-effort answer
 *      instead of burning every remaining step on the same broken action.
 */

export interface LoopGuardThresholds {
  /** Block once the same (tool, args) signature has been attempted this many times. */
  identicalCallBlock: number
  /** Start nudging the model after this many consecutive failures of one tool. */
  failureWarn: number
  /** Halt the turn after this many consecutive failures of one tool. */
  failureHalt: number
}

export const DEFAULT_LOOP_GUARD_THRESHOLDS: LoopGuardThresholds = {
  identicalCallBlock: 3,
  failureWarn: 3,
  failureHalt: 8
}

export type FailureLevel = 'ok' | 'warn' | 'halt'

/**
 * Deterministic JSON serialisation with object keys sorted recursively, so that
 * `{a:1,b:2}` and `{b:2,a:1}` map to the same call signature. Arrays keep order.
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const normalize = (val: unknown): unknown => {
    if (val === null || typeof val !== 'object') return val
    if (seen.has(val as object)) return '[Circular]'
    seen.add(val as object)
    if (Array.isArray(val)) return val.map(normalize)
    const obj = val as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = normalize(obj[key])
    }
    return out
  }
  return JSON.stringify(normalize(value))
}

export class LoopGuard {
  private readonly callCounts = new Map<string, number>()
  private readonly failureCounts = new Map<string, number>()

  constructor(private readonly thresholds: LoopGuardThresholds = DEFAULT_LOOP_GUARD_THRESHOLDS) {}

  /** Build a stable signature for a (tool, args) pair. */
  signature(toolName: string, args: unknown): string {
    return `${toolName}:${stableStringify(args)}`
  }

  /**
   * Record one execution attempt for a signature and report whether it should be
   * blocked. The blocking attempt itself is counted, so the Nth identical call is
   * the first one blocked.
   */
  recordCall(signature: string): { blocked: boolean; count: number } {
    const count = (this.callCounts.get(signature) || 0) + 1
    this.callCounts.set(signature, count)
    return { blocked: count >= this.thresholds.identicalCallBlock, count }
  }

  /** A successful execution clears the consecutive-failure streak for that tool. */
  recordSuccess(toolName: string): void {
    this.failureCounts.delete(toolName)
  }

  /** A failed execution extends the streak and reports the escalation level. */
  recordFailure(toolName: string): { level: FailureLevel; count: number } {
    const count = (this.failureCounts.get(toolName) || 0) + 1
    this.failureCounts.set(toolName, count)
    let level: FailureLevel = 'ok'
    if (count >= this.thresholds.failureHalt) {
      level = 'halt'
    } else if (count >= this.thresholds.failureWarn) {
      level = 'warn'
    }
    return { level, count }
  }
}
