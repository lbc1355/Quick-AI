/**
 * ActionLog — a per-conversation append-only journal of every tool call the agent makes.
 * Persisted as JSONL so the model can consult its own history (list_past_actions /
 * get_past_action) even after the context window has trimmed old assistant/tool messages.
 *
 * Design:
 * - One JSONL file per session (conversation).  Each line is one ActionRecord.
 * - In-memory list mirrors the file; append-only (no random updates).
 * - FIFO cap at 500 entries; oldest evicted on overflow.
 * - Argument values matching sensitive keys are redacted before write.
 * - Works without a file path (in-memory only) for tests and ephemeral runs.
 */

import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  promises as fsp
} from 'fs'
import { dirname, join } from 'path'

/** Resolve the per-conversation action-log JSONL file path under the app's userData directory. */
export function getActionLogPath(conversationId: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(app.getPath('userData'), 'action_logs', `${safeId}.jsonl`)
}

/**
 * Delete a conversation's action-log file. Best-effort: a missing file is fine, and any other
 * failure is logged but never thrown (cache cleanup must not block the session mutation).
 */
export async function deleteActionLog(conversationId: string): Promise<void> {
  const path = getActionLogPath(conversationId)
  try {
    await fsp.unlink(path)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      console.warn(`Failed to delete action log ${path}:`, e.message)
    }
  }
}

export interface ActionRecord {
  callId: string
  turnIndex: number
  timestamp: number
  toolName: string
  args: Record<string, unknown>
  resultStatus: 'success' | 'error' | 'timeout' | 'denied' | 'blocked'
  /** First 500 chars of the tool result — enough for the model to judge relevance. */
  resultSummary: string
  resultSize: number
  /** Whether the full output was preserved in the AgentRunContext tool-output store. */
  resultInOutputStore: boolean
  permission: 'allow' | 'ask' | 'deny'
  durationMs: number
}

/** Brief view returned by list_past_actions — enough to scan history without blowing context. */
export interface ActionSummary {
  callId: string
  turnIndex: number
  toolName: string
  resultStatus: ActionRecord['resultStatus']
  resultSummary: string
  resultSize: number
  resultInOutputStore: boolean
  durationMs: number
}

const SENSITIVE_ARG_KEYS = new Set([
  'apiKey',
  'api_key',
  'token',
  'password',
  'passwd',
  'secret',
  'credential',
  'authorization',
  'auth',
  'key',
  'cert',
  'privateKey',
  'private_key'
])

const REDACTED = '[redacted]'

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_ARG_KEYS.has(key)) {
      out[key] = REDACTED
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out[key] = redactArgs(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

const MAX_RECORDS = 500

export class ActionLog {
  private records: ActionRecord[] = []
  private filePath: string | null = null

  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = filePath
      this.load()
    }
  }

  // ── disk persistence ──────────────────────────────────────────────────────

  private ensureDir(): void {
    if (!this.filePath) return
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      this.records = []
      return
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const lines = raw.split('\n').filter((l) => l.trim())
      // Only keep the last MAX_RECORDS lines on load
      const relevant = lines.length > MAX_RECORDS ? lines.slice(-MAX_RECORDS) : lines
      this.records = relevant.map((line) => JSON.parse(line) as ActionRecord)
      // Rewrite if truncated
      if (lines.length > MAX_RECORDS) {
        this.flush()
      }
    } catch {
      this.records = []
    }
  }

  private flush(): void {
    if (!this.filePath) return
    this.ensureDir()
    const lines = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    writeFileSync(this.filePath, lines, 'utf-8')
  }

  private appendLine(record: ActionRecord): void {
    if (this.filePath) {
      this.ensureDir()
      appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8')
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Append a new record. Evicts oldest if over the cap. */
  append(record: ActionRecord): void {
    // Deep-copy args so callers can't mutate the stored record later.
    const stored: ActionRecord = {
      ...record,
      args: redactArgs(record.args)
    }
    this.records.push(stored)
    if (this.records.length > MAX_RECORDS) {
      this.records.shift()
    }
    this.appendLine(stored)
  }

  /** Return a page of summaries, newest first. */
  list(options?: {
    toolName?: string
    fromTurn?: number
    toTurn?: number
    limit?: number
  }): ActionSummary[] {
    let filtered = [...this.records]

    if (options?.toolName) {
      filtered = filtered.filter((r) => r.toolName === options.toolName)
    }
    if (options?.fromTurn !== undefined) {
      filtered = filtered.filter((r) => r.turnIndex >= options.fromTurn!)
    }
    if (options?.toTurn !== undefined) {
      filtered = filtered.filter((r) => r.turnIndex <= options.toTurn!)
    }

    // Newest first
    filtered.reverse()

    const limit = options?.limit ?? 20
    const page = filtered.slice(0, Math.min(limit, 50))

    return page.map((r) => ({
      callId: r.callId,
      turnIndex: r.turnIndex,
      toolName: r.toolName,
      resultStatus: r.resultStatus,
      resultSummary: r.resultSummary,
      resultSize: r.resultSize,
      resultInOutputStore: r.resultInOutputStore,
      durationMs: r.durationMs
    }))
  }

  /** Return the full record for a specific call, or undefined. */
  get(callId: string): ActionRecord | undefined {
    return this.records.find((r) => r.callId === callId)
  }

  /** Number of stored records. */
  get size(): number {
    return this.records.length
  }

  /** Write in-memory state to disk. Called on run end. */
  save(): void {
    this.flush()
  }
}
