import { resolve } from 'path'
import { PermissionManager, globalPermissionManager } from './permissionManager'
import { ActionLog } from './actionLog'
import { splitCommandSegments, analyzeCommand } from './commandSafety'
import { TaskItem } from '../../shared/types'

/** Session-scoped tool/command approvals. A "task" spans many agent runs (one per user
 *  message), each with its own reqId-keyed run context. Persisting approvals here — keyed by
 *  sessionId — lets "allow for this task" survive across those runs instead of resetting every
 *  message. In-memory only; cleared on app restart or explicitly via clearSessionApprovals. */
const sessionApprovals = new Map<string, { tools: Set<string>; prefixes: Set<string> }>()

export interface AdditionalRoot {
  path: string
  label?: string
  addedAt: number
}

const sessionAdditionalRoots = new Map<string, AdditionalRoot[]>()

const normalizeRootKey = (rootPath: string): string => {
  const resolved = resolve(rootPath).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const cloneAdditionalRoots = (roots: AdditionalRoot[] | undefined): AdditionalRoot[] =>
  roots ? roots.map((root) => ({ ...root })) : []

const upsertAdditionalRoot = (roots: AdditionalRoot[], entry: AdditionalRoot): AdditionalRoot => {
  const key = normalizeRootKey(entry.path)
  const existingIndex = roots.findIndex((root) => normalizeRootKey(root.path) === key)
  if (existingIndex !== -1) {
    roots[existingIndex] = {
      ...roots[existingIndex],
      label: entry.label || roots[existingIndex].label,
      addedAt: roots[existingIndex].addedAt
    }
    return roots[existingIndex]
  }

  roots.push(entry)
  return entry
}

function getSessionApprovals(sessionId: string): { tools: Set<string>; prefixes: Set<string> } {
  let entry = sessionApprovals.get(sessionId)
  if (!entry) {
    entry = { tools: new Set(), prefixes: new Set() }
    sessionApprovals.set(sessionId, entry)
  }
  return entry
}

export function clearSessionApprovals(sessionId: string): void {
  sessionApprovals.delete(sessionId)
  sessionAdditionalRoots.delete(sessionId)
}

export function getSessionAdditionalRoots(sessionId: string): AdditionalRoot[] {
  return cloneAdditionalRoots(sessionAdditionalRoots.get(sessionId))
}

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
  readonly projectRoot?: string
  readonly projectName?: string
  readonly approvedCommandPrefixes: string[] = []
  readonly approvedTools: string[] = []
  readonly additionalRoots: AdditionalRoot[] = []
  readonly tasks: TaskItem[] = []
  private readonly permissions: PermissionManager

  // Run-scoped store of full tool outputs, keyed by tool call id. Large outputs are kept here
  // so the model can retrieve them via read_tool_output after the context manager truncates the
  // copy that lives in the message history. Bounded by a total-bytes cap with FIFO eviction.
  private readonly toolOutputs = new Map<string, string>()
  private toolOutputsBytes = 0
  private static readonly MAX_TOOL_OUTPUT_BYTES = 5 * 1024 * 1024

  // Files the model has observed during this run (normalized real paths). Surgical edit tools
  // (file_edit, multi_edit) require a file to have been read first so the model never mutates a
  // file blindly from stale assumptions. Reading a file or writing/editing it (which establishes
  // known content) both mark it as seen. In-memory only; scoped to the run.
  private readonly seenFiles = new Set<string>()

  /** Per-conversation action log (persisted to disk). Shared across runs of the same session. */
  readonly actionLog: ActionLog

  constructor(
    reqId: string,
    initialTools: string[],
    toolScope: Set<string> | 'all',
    permissionManager: PermissionManager,
    actionLog: ActionLog,
    permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' },
    sessionId?: string,
    projectRoot?: string,
    projectName?: string
  ) {
    this.reqId = reqId
    this.sessionId = sessionId
    this.controller = new AbortController()
    this.activeTools = new Set(initialTools)
    this.executedCalls = new Set()
    this.toolScope = toolScope
    this.permissionPolicy = permissionPolicy
    this.projectRoot = projectRoot
    this.projectName = projectName
    this.permissions = permissionManager
    this.actionLog = actionLog

    // Inherit approvals granted in earlier runs of the same conversation so "allow for this
    // task" persists across messages instead of re-prompting on every new run.
    if (sessionId) {
      const prior = sessionApprovals.get(sessionId)
      if (prior) {
        this.approvedTools.push(...prior.tools)
        this.approvedCommandPrefixes.push(...prior.prefixes)
      }

      this.additionalRoots.push(...cloneAdditionalRoots(sessionAdditionalRoots.get(sessionId)))
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Merge incoming tasks into the run's task list: new IDs are added, existing IDs get
   *  their status updated. Returns the full merged list. */
  mergeTasks(incoming: TaskItem[]): TaskItem[] {
    const byId = new Map<string, TaskItem>()
    for (const t of this.tasks) byId.set(t.id, t)
    for (const t of incoming) {
      if (byId.has(t.id)) {
        const existing = byId.get(t.id)!
        // Only update if the status actually changed to avoid churn.
        if (existing.status !== t.status) {
          byId.set(t.id, { ...existing, status: t.status, title: t.title || existing.title })
        }
      } else {
        byId.set(t.id, { ...t })
      }
    }
    const merged = Array.from(byId.values())
    this.tasks.length = 0
    this.tasks.push(...merged)
    return merged
  }

  abort(): void {
    this.controller.abort()
    this.permissions.cleanupForRun(this.reqId)
  }

  isToolActive(toolName: string): boolean {
    return this.activeTools.has(toolName)
  }

  addAdditionalRoot(rootPath: string, label?: string): AdditionalRoot {
    const entry: AdditionalRoot = {
      path: resolve(rootPath),
      ...(label?.trim() ? { label: label.trim() } : {}),
      addedAt: Date.now()
    }
    const stored = upsertAdditionalRoot(this.additionalRoots, entry)

    if (this.sessionId) {
      const sessionRoots = sessionAdditionalRoots.get(this.sessionId) || []
      upsertAdditionalRoot(sessionRoots, stored)
      sessionAdditionalRoots.set(this.sessionId, sessionRoots)
    }

    return { ...stored }
  }

  getAdditionalRoots(): AdditionalRoot[] {
    return cloneAdditionalRoots(this.additionalRoots)
  }

  getAdditionalRootPaths(): string[] {
    return this.additionalRoots.map((root) => root.path)
  }

  activateTool(toolName: string): void {
    this.activeTools.add(toolName)
  }

  approveTool(toolName: string): void {
    if (toolName && !this.approvedTools.includes(toolName)) {
      this.approvedTools.push(toolName)
      console.log(`[AgentRunContext] Approved tool for run ${this.reqId}: "${toolName}"`)
    }
    if (toolName && this.sessionId) {
      getSessionApprovals(this.sessionId).tools.add(toolName)
    }
  }

  isToolApproved(toolName: string): boolean {
    return this.approvedTools.includes(toolName)
  }

  approveCommandPrefix(prefix: string): void {
    const p = prefix.trim().toLowerCase()
    if (p && !this.approvedCommandPrefixes.includes(p)) {
      this.approvedCommandPrefixes.push(p)
      console.log(`[AgentRunContext] Approved command prefix for run ${this.reqId}: "${p}"`)
    }
    if (p && this.sessionId) {
      getSessionApprovals(this.sessionId).prefixes.add(p)
    }
  }

  isCommandPrefixApproved(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) return false
    // Command substitution (`$(...)` / backticks) is opaque to prefix matching — its body can
    // run anything — so always force a fresh confirmation when present.
    if (/\$\(|`/.test(trimmed)) return false
    if (this.approvedCommandPrefixes.length === 0) return false

    // A chained command (`a && b`, `a | b`, `a; b`, ...) is approved only when EVERY independently
    // executed segment's leading prefix was itself approved. This lets the Windows-idiomatic
    // `cd "x" && type "y"` ride approvals for both `cd` and `type`, while any unapproved segment
    // still forces a prompt. Destructive segments are denied separately by analyzeCommand (a deny
    // is never rescued by prefix approval), so segment-level allow cannot smuggle danger through.
    const segments = splitCommandSegments(trimmed)
    if (segments.length === 0) return false
    return segments.every((segment) => {
      // Safe segments (e.g. read-only commands) don't need explicit prefix approval.
      if (analyzeCommand(segment).level === 'safe') return true
      return this.isSegmentPrefixApproved(segment)
    })
  }

  private isSegmentPrefixApproved(segment: string): boolean {
    const seg = segment.trim().toLowerCase()
    if (!seg) return false
    return this.approvedCommandPrefixes.some(
      (prefix) => seg === prefix || seg.startsWith(prefix + ' ') || seg.startsWith(prefix + '\t')
    )
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

  /** Record that the model has observed a file's content (via read or a successful write/edit). */
  markFileSeen(realPath: string): void {
    this.seenFiles.add(AgentRunContext.normalizeSeenPath(realPath))
  }

  /** Whether the model has observed this file's content earlier in the run. */
  hasSeenFile(realPath: string): boolean {
    return this.seenFiles.has(AgentRunContext.normalizeSeenPath(realPath))
  }

  private static normalizeSeenPath(p: string): string {
    const normalized = p.replace(/\\/g, '/')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
}

const activeRuns = new Map<string, AgentRunContext>()

export function createRun(
  reqId: string,
  initialTools: string[],
  toolScope: Set<string> | 'all',
  actionLog: ActionLog,
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' },
  sessionId?: string,
  projectRoot?: string,
  projectName?: string
): AgentRunContext {
  const ctx = new AgentRunContext(
    reqId,
    initialTools,
    toolScope,
    globalPermissionManager,
    actionLog,
    permissionPolicy,
    sessionId,
    projectRoot,
    projectName
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
