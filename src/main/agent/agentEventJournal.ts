import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  promises as fsp
} from 'fs'
import { dirname, join } from 'path'
import { compactAgentEvents } from '../../shared/agentEventCompactor'
import type { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { normalizeContextEpoch } from '../../shared/contextEpoch'
import {
  ModelRequestJournalRecord,
  ModelRequestJournalSummary,
  settleModelRequestRecord,
  summarizeModelRequestRecord,
  verifyModelRequestRecord
} from './modelRequestRecord'

const JOURNAL_VERSION = 1
const FLUSH_INTERVAL_MS = 150
const MAX_EVENTS = 1500
const MAX_JOURNAL_CHARS = 5 * 1024 * 1024
const MAX_EVENT_CHARS = 256 * 1024
const MAX_VALUE_DEPTH = 10
const MAX_ARRAY_ITEMS = 200
const MAX_OBJECT_KEYS = 200
const MAX_STRING_CHARS = 128 * 1024
const MAX_REQUEST_HISTORY = 100
const REDACTED_VALUE = '[REDACTED]'
const INTERRUPTION_ERROR = 'Agent run was interrupted before the application exited.'

export type AgentEventJournalStatus =
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'max_steps'
  | 'safety_stop'
  | 'interrupted'

export interface AgentEventJournalSnapshot {
  version: typeof JOURNAL_VERSION
  runId: string
  sessionId: string
  /** Missing in journals written before Context Epoch support; treated as epoch zero. */
  contextEpoch?: number
  sourceMessageId?: string
  assistantMessageId?: string
  parentRunId?: string
  status: AgentEventJournalStatus
  events: AgentEvent[]
  /** Exact semantic input plus credential-free provider metadata for the latest call. */
  latestModelRequest?: ModelRequestJournalRecord
  /** Bounded fingerprints for earlier requests; only the latest full payload is retained. */
  modelRequestHistory?: ModelRequestJournalSummary[]
  lastSequence: number
  startedAt: number
  updatedAt: number
  completedAt?: number
}

export interface CreateAgentEventJournalInput {
  runId: string
  sessionId: string
  contextEpoch?: number
  sourceMessageId?: string
  assistantMessageId?: string
  parentRunId?: string
}

export interface AgentEventJournalWriter {
  append: (event: AgentEvent) => void
  recordModelRequest: (record: ModelRequestJournalRecord) => void
  settleModelRequest: (requestId: string, response: ChatCompletionMessage) => void
  flush: () => void
  close: () => void
  getSnapshot: () => AgentEventJournalSnapshot
}

const isSensitiveKey = (key: string): boolean =>
  /(?:api[-_]?key|authorization|password|passwd|secret|access[-_]?token|refresh[-_]?token|cookie)/i.test(
    key
  )

const truncateString = (value: string, maxChars = MAX_STRING_CHARS): string => {
  if (value.length <= maxChars) return value
  const omitted = value.length - maxChars
  return `${value.slice(0, maxChars)}\n[${omitted} characters truncated]`
}

const sanitizeValue = (value: unknown, key = '', depth = 0): unknown => {
  if (isSensitiveKey(key)) return REDACTED_VALUE
  if (value === undefined) return undefined
  if (typeof value === 'string') return truncateString(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= MAX_VALUE_DEPTH) return '[Maximum depth reached]'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, '', depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} items truncated]`)
    }
    return items
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    const sanitized: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of entries) {
      sanitized[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1)
    }
    if (Object.keys(value as Record<string, unknown>).length > MAX_OBJECT_KEYS) {
      sanitized.__truncated__ = true
    }
    return sanitized
  }
  return String(value)
}

const shrinkOversizedEvent = (event: AgentEvent): AgentEvent => {
  const record = event as AgentEvent & Record<string, unknown>
  const compact: Record<string, unknown> = {
    type: event.type,
    runId: event.runId,
    sequence: event.sequence,
    timestamp: event.timestamp
  }
  for (const key of [
    'skillName',
    'step',
    'stepId',
    'maxSteps',
    'callId',
    'toolName',
    'stream',
    'status',
    'subagentId',
    'parentToolCallId',
    'label',
    'durationMs'
  ]) {
    if (record[key] !== undefined) compact[key] = record[key]
  }
  if (typeof record.content === 'string')
    compact.content = truncateString(record.content, 64 * 1024)
  if (typeof record.error === 'string') compact.error = truncateString(record.error, 16 * 1024)
  if (typeof record.message === 'string')
    compact.message = truncateString(record.message, 16 * 1024)
  if (typeof record.purpose === 'string')
    compact.purpose = truncateString(record.purpose, 16 * 1024)
  if (typeof record.task === 'string') compact.task = truncateString(record.task, 16 * 1024)
  if (event.type === 'tool_call') compact.args = { __truncated__: 'Oversized tool arguments' }
  if (event.type === 'tool_result') {
    compact.result = {
      title: event.result.title,
      summary: '[Oversized tool result truncated in durable event history]'
    }
  }
  if (event.type === 'agent_progress') {
    compact.activeTools = event.activeTools?.slice(0, 100)
  }
  if (event.type === 'task_update') compact.tasks = event.tasks.slice(0, 100)
  if (event.type === 'file_changes') compact.files = event.files.slice(0, 500)
  if (event.type === 'subagent_event') {
    compact.event = {
      type: event.event.type,
      runId: event.event.runId,
      sequence: event.event.sequence,
      timestamp: event.event.timestamp
    }
  }
  return compact as unknown as AgentEvent
}

export const sanitizeAgentEventForJournal = (event: AgentEvent): AgentEvent => {
  const sanitized = sanitizeValue(event) as AgentEvent
  return JSON.stringify(sanitized).length <= MAX_EVENT_CHARS
    ? sanitized
    : shrinkOversizedEvent(sanitized)
}

const terminalStatusForEvent = (event: AgentEvent): AgentEventJournalStatus | undefined =>
  event.type === 'agent_end' ? event.status : undefined

const getLastSequence = (events: AgentEvent[]): number =>
  events.reduce((highest, event) => Math.max(highest, event.sequence || 0), 0)

const pruneEventCount = (events: AgentEvent[]): AgentEvent[] => {
  if (events.length <= MAX_EVENTS) return events
  const firstStart = events.find((event) => event.type === 'agent_start')
  const lastEnd = [...events].reverse().find((event) => event.type === 'agent_end')
  const reserved = Number(Boolean(firstStart)) + Number(Boolean(lastEnd))
  const tail = events
    .filter((event) => event !== firstStart && event !== lastEnd)
    .slice(-(MAX_EVENTS - reserved))
  return [...(firstStart ? [firstStart] : []), ...tail, ...(lastEnd ? [lastEnd] : [])]
}

const compactForJournal = (events: AgentEvent[]): AgentEvent[] => {
  let compacted = pruneEventCount(
    compactAgentEvents(events.filter((event) => event.type !== 'resource_update')).map(
      sanitizeAgentEventForJournal
    )
  )

  let serialized = JSON.stringify(compacted)
  while (serialized.length > MAX_JOURNAL_CHARS && compacted.length > 2) {
    const firstStart = compacted.find((event) => event.type === 'agent_start')
    const lastEnd = [...compacted].reverse().find((event) => event.type === 'agent_end')
    const middle = compacted.filter((event) => event !== firstStart && event !== lastEnd)
    compacted = [
      ...(firstStart ? [firstStart] : []),
      ...middle.slice(-Math.max(1, Math.floor(middle.length / 2))),
      ...(lastEnd ? [lastEnd] : [])
    ]
    serialized = JSON.stringify(compacted)
  }
  return compacted
}

const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '_')

export const getAgentEventJournalRoot = (): string =>
  join(app.getPath('userData'), 'agent_event_journals')

export const getAgentEventJournalDir = (sessionId: string): string =>
  join(getAgentEventJournalRoot(), safeId(sessionId))

export const getAgentEventJournalPath = (sessionId: string, runId: string): string =>
  join(getAgentEventJournalDir(sessionId), `${safeId(runId)}.json`)

const writeJournal = (snapshot: AgentEventJournalSnapshot): void => {
  const path = getAgentEventJournalPath(snapshot.sessionId, snapshot.runId)
  const directory = dirname(path)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  snapshot.updatedAt = Date.now()
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(snapshot), 'utf-8')
  try {
    renameSync(temporaryPath, path)
  } catch {
    // Some Windows filesystems do not replace an existing destination atomically. The temporary
    // file still prevents a partially-written destination in the common path.
    writeFileSync(path, JSON.stringify(snapshot), 'utf-8')
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Best effort cleanup.
    }
  }
}

export const loadAgentEventJournal = (
  sessionId: string,
  runId: string
): AgentEventJournalSnapshot | undefined => {
  const path = getAgentEventJournalPath(sessionId, runId)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AgentEventJournalSnapshot
    if (
      parsed.version !== JOURNAL_VERSION ||
      parsed.sessionId !== sessionId ||
      parsed.runId !== runId ||
      !Array.isArray(parsed.events)
    ) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export const loadSessionAgentEventJournals = (sessionId: string): AgentEventJournalSnapshot[] => {
  const directory = getAgentEventJournalDir(sessionId)
  if (!existsSync(directory)) return []
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        try {
          return JSON.parse(readFileSync(join(directory, entry.name), 'utf-8')) as
            | AgentEventJournalSnapshot
            | undefined
        } catch {
          return undefined
        }
      })
      .filter(
        (snapshot): snapshot is AgentEventJournalSnapshot =>
          snapshot?.version === JOURNAL_VERSION &&
          snapshot.sessionId === sessionId &&
          typeof snapshot.runId === 'string' &&
          Array.isArray(snapshot.events)
      )
      .sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))
  } catch {
    return []
  }
}

class FileAgentEventJournalWriter implements AgentEventJournalWriter {
  private snapshot: AgentEventJournalSnapshot
  private pending: AgentEvent[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private enabled = true

  constructor(input: CreateAgentEventJournalInput) {
    const now = Date.now()
    this.snapshot = {
      version: JOURNAL_VERSION,
      runId: input.runId,
      sessionId: input.sessionId,
      contextEpoch: normalizeContextEpoch(input.contextEpoch),
      sourceMessageId: input.sourceMessageId,
      assistantMessageId: input.assistantMessageId,
      parentRunId: input.parentRunId,
      status: 'running',
      events: [],
      lastSequence: 0,
      startedAt: now,
      updatedAt: now
    }
    try {
      writeJournal(this.snapshot)
    } catch (error) {
      this.enabled = false
      console.warn('Agent event journal is unavailable:', (error as Error).message)
    }
  }

  append(event: AgentEvent): void {
    if (!this.enabled || event.type === 'resource_update') return
    this.pending.push(sanitizeAgentEventForJournal(event))
    const terminalStatus = terminalStatusForEvent(event)
    if (terminalStatus) {
      this.snapshot.status = terminalStatus
      this.snapshot.completedAt = event.timestamp || Date.now()
      this.flush()
      return
    }
    if (this.pending.length >= 100) {
      this.flush()
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
      this.timer.unref?.()
    }
  }

  private replaceRequestSummary(record: ModelRequestJournalRecord): void {
    const history = (this.snapshot.modelRequestHistory || []).filter(
      (entry) => entry.requestId !== record.requestId
    )
    this.snapshot.modelRequestHistory = [...history, summarizeModelRequestRecord(record)].slice(
      -MAX_REQUEST_HISTORY
    )
  }

  private persistMetadataChange(): void {
    if (!this.enabled) return
    try {
      writeJournal(this.snapshot)
    } catch (error) {
      this.enabled = false
      console.warn('Failed to persist agent request metadata:', (error as Error).message)
    }
  }

  recordModelRequest(record: ModelRequestJournalRecord): void {
    this.flush()
    if (!this.enabled) return
    this.snapshot.latestModelRequest = record
    this.replaceRequestSummary(record)
    // This write is the durability boundary: it completes before the provider call starts.
    this.persistMetadataChange()
  }

  settleModelRequest(requestId: string, response: ChatCompletionMessage): void {
    this.flush()
    if (!this.enabled || this.snapshot.latestModelRequest?.requestId !== requestId) return
    const settled = settleModelRequestRecord(this.snapshot.latestModelRequest, response)
    this.snapshot.latestModelRequest = settled
    this.replaceRequestSummary(settled)
    this.persistMetadataChange()
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.enabled || this.pending.length === 0) return
    this.snapshot.events = compactForJournal([...this.snapshot.events, ...this.pending])
    this.pending = []
    this.snapshot.lastSequence = getLastSequence(this.snapshot.events)
    try {
      writeJournal(this.snapshot)
    } catch (error) {
      this.enabled = false
      console.warn('Failed to persist agent events:', (error as Error).message)
    }
  }

  close(): void {
    this.flush()
  }

  getSnapshot(): AgentEventJournalSnapshot {
    return {
      ...this.snapshot,
      events: compactForJournal([...this.snapshot.events, ...this.pending])
    }
  }
}

export const createAgentEventJournalWriter = (
  input: CreateAgentEventJournalInput
): AgentEventJournalWriter => new FileAgentEventJournalWriter(input)

export const getPendingReconstructableModelRequest = (
  snapshot: AgentEventJournalSnapshot
): ModelRequestJournalRecord | undefined => {
  const record = snapshot.latestModelRequest
  return record?.state === 'prepared' && verifyModelRequestRecord(record) ? record : undefined
}

const collectJournalFiles = (): string[] => {
  const root = getAgentEventJournalRoot()
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const directory = join(root, entry.name)
      try {
        return readdirSync(directory, { withFileTypes: true })
          .filter((file) => file.isFile() && file.name.endsWith('.json'))
          .map((file) => join(directory, file.name))
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export const recoverInterruptedAgentEventJournals = (): AgentEventJournalSnapshot[] => {
  const recovered: AgentEventJournalSnapshot[] = []
  for (const path of collectJournalFiles()) {
    try {
      const snapshot = JSON.parse(readFileSync(path, 'utf-8')) as AgentEventJournalSnapshot
      if (snapshot.version !== JOURNAL_VERSION || snapshot.status !== 'running') continue
      const timestamp = Date.now()
      const lastSequence = Math.max(snapshot.lastSequence || 0, getLastSequence(snapshot.events))
      const interruptedEvent: AgentEvent = {
        type: 'agent_end',
        status: 'failed',
        error: INTERRUPTION_ERROR,
        runId: snapshot.runId,
        sequence: lastSequence + 1,
        timestamp
      }
      const next: AgentEventJournalSnapshot = {
        ...snapshot,
        status: 'interrupted',
        events: compactForJournal([...snapshot.events, interruptedEvent]),
        lastSequence: lastSequence + 1,
        completedAt: timestamp,
        updatedAt: timestamp
      }
      writeJournal(next)
      recovered.push(next)
    } catch {
      // Ignore a corrupt journal; intact runs remain independently recoverable.
    }
  }
  return recovered
}

export const copyAgentEventJournalsForRuns = (
  sourceSessionId: string,
  targetSessionId: string,
  runIds: string[]
): number => {
  if (sourceSessionId === targetSessionId || runIds.length === 0) return 0
  let copied = 0
  for (const runId of Array.from(new Set(runIds))) {
    const journal = loadAgentEventJournal(sourceSessionId, runId)
    if (!journal) continue
    writeJournal({
      ...journal,
      sessionId: targetSessionId,
      ...(journal.latestModelRequest
        ? {
            latestModelRequest: {
              ...journal.latestModelRequest,
              sessionId: targetSessionId
            }
          }
        : {}),
      updatedAt: Date.now()
    })
    copied += 1
  }
  return copied
}

export const deleteAgentEventJournal = async (sessionId: string, runId: string): Promise<void> => {
  try {
    await fsp.unlink(getAgentEventJournalPath(sessionId, runId))
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException
    if (fileError.code !== 'ENOENT') {
      console.warn('Failed to delete agent event journal:', fileError.message)
    }
  }
}

export const deleteAgentEventJournals = async (sessionId: string): Promise<void> => {
  try {
    rmSync(getAgentEventJournalDir(sessionId), { recursive: true, force: true })
  } catch (error) {
    console.warn('Failed to delete agent event journals:', (error as Error).message)
  }
}
