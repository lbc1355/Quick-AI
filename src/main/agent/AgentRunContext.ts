import { PermissionManager, globalPermissionManager } from './permissionManager'
import { ActionLog } from './actionLog'

export class AgentRunContext {
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'max_steps' = 'running'
  readonly startedAt: number = Date.now()
  currentStep = 1
  maxSteps = 30
  completedAt?: number
  error?: string
  readonly reqId: string
  /** The conversation this run belongs to. Used by memory tools to scope session memories.
   * Undefined for runs started without a session (memory falls back to global-only). */
  readonly sessionId?: string
  readonly controller: AbortController
  readonly activeTools: Set<string>
  readonly executedCalls: Set<string>
  readonly toolScope: Set<string> | 'all'
  readonly permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
  readonly approvedCommandPrefixes: string[] = []
  readonly approvedTools: string[] = []
  private readonly permissions: PermissionManager

  // Run-scoped store of full tool outputs, keyed by tool call id. Large outputs are kept here
  // so the model can retrieve them via read_tool_output after the context manager truncates the
  // copy that lives in the message history. Bounded by a total-bytes cap with FIFO eviction.
  private readonly toolOutputs = new Map<string, string>()
  private toolOutputsBytes = 0
  private static readonly MAX_TOOL_OUTPUT_BYTES = 5 * 1024 * 1024

  /** Per-conversation action log (persisted to disk). Shared across runs of the same session. */
  readonly actionLog: ActionLog

  constructor(
    reqId: string,
    initialTools: string[],
    toolScope: Set<string> | 'all',
    permissionManager: PermissionManager,
    actionLog: ActionLog,
    permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' },
    sessionId?: string
  ) {
    this.reqId = reqId
    this.sessionId = sessionId
    this.controller = new AbortController()
    this.activeTools = new Set(initialTools)
    this.executedCalls = new Set()
    this.toolScope = toolScope
    this.permissionPolicy = permissionPolicy
    this.permissions = permissionManager
    this.actionLog = actionLog
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  abort(): void {
    this.controller.abort()
    this.permissions.cleanupForRun(this.reqId)
  }

  isToolActive(toolName: string): boolean {
    return this.activeTools.has(toolName)
  }

  activateTool(toolName: string): void {
    this.activeTools.add(toolName)
  }

  approveTool(toolName: string): void {
    if (toolName && !this.approvedTools.includes(toolName)) {
      this.approvedTools.push(toolName)
      console.log(`[AgentRunContext] Approved tool for run ${this.reqId}: "${toolName}"`)
    }
  }

  isToolApproved(toolName: string): boolean {
    return this.approvedTools.includes(toolName)
  }

  approveCommandPrefix(prefix: string): void {
    const p = prefix.trim()
    if (p && !this.approvedCommandPrefixes.includes(p)) {
      this.approvedCommandPrefixes.push(p)
      console.log(`[AgentRunContext] Approved command prefix for run ${this.reqId}: "${p}"`)
    }
  }

  isCommandPrefixApproved(command: string): boolean {
    const trimmed = command.trim()
    // A previously-approved prefix only covers a SINGLE simple command. If the command chains or
    // embeds another command (`;` `&&` `||` `|` `&`, newline, or `$(...)`/backtick substitution),
    // the approved prefix must not silently cover the tail — force a fresh confirmation.
    if (/[;&|\n]|\$\(|`/.test(trimmed)) return false
    return this.approvedCommandPrefixes.some((prefix) => {
      return (
        trimmed === prefix || trimmed.startsWith(prefix + ' ') || trimmed.startsWith(prefix + '\t')
      )
    })
  }

  hasExecuted(callKey: string): boolean {
    return this.executedCalls.has(callKey)
  }

  markExecuted(callKey: string): void {
    this.executedCalls.add(callKey)
  }

  /** Preserve a full tool output for later retrieval, evicting oldest entries past the cap. */
  storeToolOutput(callId: string, text: string): void {
    const previous = this.toolOutputs.get(callId)
    if (previous !== undefined) {
      this.toolOutputsBytes -= previous.length
      this.toolOutputs.delete(callId)
    }
    this.toolOutputs.set(callId, text)
    this.toolOutputsBytes += text.length

    // Map preserves insertion order, so the first key is the oldest entry.
    while (
      this.toolOutputsBytes > AgentRunContext.MAX_TOOL_OUTPUT_BYTES &&
      this.toolOutputs.size > 1
    ) {
      const oldest = this.toolOutputs.keys().next().value as string
      this.toolOutputsBytes -= this.toolOutputs.get(oldest)?.length || 0
      this.toolOutputs.delete(oldest)
    }
  }

  getToolOutput(callId: string): string | undefined {
    return this.toolOutputs.get(callId)
  }
}

const activeRuns = new Map<string, AgentRunContext>()

export function createRun(
  reqId: string,
  initialTools: string[],
  toolScope: Set<string> | 'all',
  actionLog: ActionLog,
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' },
  sessionId?: string
): AgentRunContext {
  const ctx = new AgentRunContext(
    reqId,
    initialTools,
    toolScope,
    globalPermissionManager,
    actionLog,
    permissionPolicy,
    sessionId
  )
  activeRuns.set(reqId, ctx)
  return ctx
}

export function getRun(reqId: string): AgentRunContext | undefined {
  return activeRuns.get(reqId)
}

export function abortRun(reqId: string): void {
  const ctx = activeRuns.get(reqId)
  if (ctx) {
    ctx.abort()
  }
}

export function destroyRun(reqId: string): void {
  const ctx = activeRuns.get(reqId)
  if (ctx) {
    ctx.abort()
    activeRuns.delete(reqId)
  }
}
