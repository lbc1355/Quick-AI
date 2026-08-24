import type { ToolArgs } from '../../shared/types'
import type { ToolDefinition } from '../tools/types'

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000
export const TOOL_CANCELLATION_DRAIN_GRACE_MS = 2_500

export type ToolExecutionAbortKind = 'cancelled' | 'timed_out'

export class ToolExecutionLifecycleError extends Error {
  readonly kind: ToolExecutionAbortKind
  readonly timeoutMs?: number
  readonly drainTimedOut: boolean
  readonly executionStarted: boolean

  constructor(options: {
    toolName: string
    kind: ToolExecutionAbortKind
    timeoutMs?: number
    drainTimedOut?: boolean
    executionStarted?: boolean
    cause?: unknown
  }) {
    const base =
      options.kind === 'timed_out'
        ? `Tool "${options.toolName}" timed out after ${options.timeoutMs}ms.`
        : `Tool "${options.toolName}" was cancelled.`
    super(
      options.drainTimedOut
        ? `${base} It did not settle within the cancellation grace period; any late result will be ignored.`
        : base,
      options.cause !== undefined ? { cause: options.cause } : undefined
    )
    this.name = 'ToolExecutionLifecycleError'
    this.kind = options.kind
    this.timeoutMs = options.timeoutMs
    this.drainTimedOut = options.drainTimedOut === true
    this.executionStarted = options.executionStarted !== false
  }
}

export const isToolExecutionLifecycleError = (
  error: unknown
): error is ToolExecutionLifecycleError => error instanceof ToolExecutionLifecycleError

export function resolveToolTimeoutMs(tool: ToolDefinition, args: ToolArgs): number | undefined {
  if (tool.timeoutMs !== undefined) {
    try {
      const resolved = typeof tool.timeoutMs === 'function' ? tool.timeoutMs(args) : tool.timeoutMs
      if (resolved === undefined) return undefined
      return typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0
        ? Math.floor(resolved)
        : DEFAULT_TOOL_TIMEOUT_MS
    } catch {
      return DEFAULT_TOOL_TIMEOUT_MS
    }
  }
  // MCP already owns a progress-aware deadline. A second fixed timer would cancel healthy calls
  // whose server is actively reporting progress and resetting its configured timeout.
  if (tool.source === 'mcp') return undefined
  return DEFAULT_TOOL_TIMEOUT_MS
}

export async function runWithToolExecutionLifecycle<T>(options: {
  toolName: string
  callerSignal: AbortSignal
  timeoutMs?: number
  drainGraceMs?: number
  execute: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  if (options.callerSignal.aborted) {
    throw new ToolExecutionLifecycleError({
      toolName: options.toolName,
      kind: 'cancelled',
      executionStarted: false
    })
  }

  const controller = new AbortController()
  const drainGraceMs = options.drainGraceMs ?? TOOL_CANCELLATION_DRAIN_GRACE_MS
  let abortKind: ToolExecutionAbortKind | undefined
  let timeout: NodeJS.Timeout | undefined
  let drainTimer: NodeJS.Timeout | undefined

  const lifecycleError = (drainTimedOut: boolean, cause?: unknown): ToolExecutionLifecycleError =>
    new ToolExecutionLifecycleError({
      toolName: options.toolName,
      kind: abortKind || 'cancelled',
      timeoutMs: options.timeoutMs,
      drainTimedOut,
      cause
    })

  let rejectAfterDrain: ((error: ToolExecutionLifecycleError) => void) | undefined
  const drainDeadline = new Promise<never>((_resolve, reject) => {
    rejectAfterDrain = reject
  })
  const beginAbort = (kind: ToolExecutionAbortKind): void => {
    if (abortKind) return
    abortKind = kind
    controller.abort(lifecycleError(false))
    drainTimer = setTimeout(() => rejectAfterDrain?.(lifecycleError(true)), drainGraceMs)
    drainTimer.unref?.()
  }
  const onCallerAbort = (): void => beginAbort('cancelled')

  options.callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  if (options.callerSignal.aborted) beginAbort('cancelled')
  if (!abortKind && options.timeoutMs !== undefined) {
    timeout = setTimeout(() => beginAbort('timed_out'), options.timeoutMs)
    timeout.unref?.()
  }

  const execution = Promise.resolve().then(() => options.execute(controller.signal))
  const observed = execution.then(
    (value) => {
      if (abortKind) throw lifecycleError(false)
      return value
    },
    (error: unknown) => {
      if (abortKind) throw lifecycleError(false, error)
      throw error
    }
  )

  try {
    return await Promise.race([observed, drainDeadline])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (drainTimer) clearTimeout(drainTimer)
    options.callerSignal.removeEventListener('abort', onCallerAbort)
  }
}
