import {
  AdmitSessionPromptInput,
  ChatCompletionMessage,
  SessionPromptAdmission,
  SessionPromptAdmissionMode,
  SessionPromptAdmissionStatus,
  RunMode
} from '../../shared/types'
import { getDb } from './connection'
import { normalizeContextEpoch } from '../../shared/contextEpoch'
import { normalizeReasoningPreference } from '../../shared/reasoningControl'

interface SessionPromptRow {
  id: string
  sessionId: string
  contextEpoch: number
  mode: string
  status: string
  runMode: string
  sourceMessageId: string
  assistantMessageId: string | null
  messages: string
  requestedReasoningPreference: string | null
  effectiveReasoningPreference: string | null
  createdAt: number
  updatedAt: number
}

export interface StoredSessionPromptAdmission {
  prompt: SessionPromptAdmission
  inserted: boolean
}

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

const parseMessages = (value: string): ChatCompletionMessage[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as ChatCompletionMessage[]) : []
  } catch {
    return []
  }
}

const rowToPrompt = (row: SessionPromptRow): SessionPromptAdmission => ({
  id: row.id,
  sessionId: row.sessionId,
  contextEpoch: normalizeContextEpoch(row.contextEpoch),
  mode: row.mode as SessionPromptAdmissionMode,
  status: row.status as SessionPromptAdmissionStatus,
  runMode: row.runMode as RunMode,
  sourceMessageId: row.sourceMessageId,
  ...(row.assistantMessageId ? { assistantMessageId: row.assistantMessageId } : {}),
  messages: parseMessages(row.messages),
  ...(row.requestedReasoningPreference
    ? {
        requestedReasoningPreference: normalizeReasoningPreference(row.requestedReasoningPreference)
      }
    : {}),
  ...(row.effectiveReasoningPreference
    ? {
        effectiveReasoningPreference: normalizeReasoningPreference(row.effectiveReasoningPreference)
      }
    : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const getPromptRow = (id: string): SessionPromptRow | undefined =>
  getDb().prepare('SELECT * FROM session_prompt_inbox WHERE id = ?').get(id) as
    | SessionPromptRow
    | undefined

export function admitSessionPrompt(input: AdmitSessionPromptInput): StoredSessionPromptAdmission {
  const id = requireText(input.id, 'Prompt admission id')
  const sessionId = requireText(input.sessionId, 'Session id')
  const sourceMessageId = requireText(input.sourceMessageId, 'Source message id')
  const contextEpoch = normalizeContextEpoch(input.contextEpoch)
  const assistantMessageId = input.assistantMessageId
    ? requireText(input.assistantMessageId, 'Assistant message id')
    : null
  if (input.mode !== 'steer' && input.mode !== 'queue') {
    throw new Error('Prompt admission mode must be steer or queue')
  }
  if (input.runMode !== 'chat' && input.runMode !== 'agent') {
    throw new Error('Prompt run mode must be chat or agent')
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error('Prompt messages are required')
  }

  const requestedReasoningPreference = input.requestedReasoningPreference
    ? normalizeReasoningPreference(input.requestedReasoningPreference)
    : null
  const effectiveReasoningPreference = input.effectiveReasoningPreference
    ? normalizeReasoningPreference(input.effectiveReasoningPreference)
    : null
  const now = Date.now()
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO session_prompt_inbox
       (id, sessionId, contextEpoch, mode, status, runMode, sourceMessageId, assistantMessageId, messages, requestedReasoningPreference, effectiveReasoningPreference, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      sessionId,
      contextEpoch,
      input.mode,
      input.runMode,
      sourceMessageId,
      assistantMessageId,
      JSON.stringify(input.messages),
      requestedReasoningPreference,
      effectiveReasoningPreference,
      now,
      now
    )

  const row = getPromptRow(id)
  if (!row) throw new Error(`Failed to persist prompt admission ${id}`)
  if (
    row.sessionId !== sessionId ||
    normalizeContextEpoch(row.contextEpoch) !== contextEpoch ||
    row.sourceMessageId !== sourceMessageId ||
    row.mode !== input.mode ||
    row.runMode !== input.runMode ||
    row.assistantMessageId !== assistantMessageId ||
    row.messages !== JSON.stringify(input.messages)
  ) {
    throw new Error(`Prompt admission id ${id} is already used by another prompt`)
  }
  return { prompt: rowToPrompt(row), inserted: result.changes === 1 }
}

export function listSessionPrompts(sessionId: string): SessionPromptAdmission[] {
  const normalizedSessionId = requireText(sessionId, 'Session id')
  const rows = getDb()
    .prepare(
      `SELECT * FROM session_prompt_inbox
       WHERE sessionId = ? AND status IN ('pending', 'running')
       ORDER BY createdAt ASC, rowid ASC`
    )
    .all(normalizedSessionId) as SessionPromptRow[]
  return rows.map(rowToPrompt)
}

export function getSessionPrompt(id: string): SessionPromptAdmission | undefined {
  const row = getPromptRow(requireText(id, 'Prompt admission id'))
  return row ? rowToPrompt(row) : undefined
}

export function markSessionPromptRunning(id: string): boolean {
  const normalizedId = requireText(id, 'Prompt admission id')
  const result = getDb()
    .prepare(
      `UPDATE session_prompt_inbox
       SET status = 'running', updatedAt = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(Date.now(), normalizedId)
  return result.changes === 1
}

export function claimNextSessionPrompt(
  sessionId: string,
  contextEpoch?: number
): SessionPromptAdmission | undefined {
  const normalizedSessionId = requireText(sessionId, 'Session id')
  const normalizedEpoch =
    contextEpoch === undefined ? undefined : normalizeContextEpoch(contextEpoch)
  const database = getDb()
  return database.transaction((): SessionPromptAdmission | undefined => {
    if (normalizedEpoch !== undefined) {
      database
        .prepare(
          `UPDATE session_prompt_inbox
           SET status = 'cancelled', updatedAt = ?
           WHERE sessionId = ? AND status = 'pending' AND contextEpoch <> ?`
        )
        .run(Date.now(), normalizedSessionId, normalizedEpoch)
    }
    const row = database
      .prepare(
        `SELECT * FROM session_prompt_inbox
         WHERE sessionId = ? AND status = 'pending'
           ${normalizedEpoch === undefined ? '' : 'AND contextEpoch = ?'}
         ORDER BY createdAt ASC, rowid ASC LIMIT 1`
      )
      .get(
        ...(normalizedEpoch === undefined
          ? [normalizedSessionId]
          : [normalizedSessionId, normalizedEpoch])
      ) as SessionPromptRow | undefined
    if (!row) return undefined

    const result = database
      .prepare(
        `UPDATE session_prompt_inbox
         SET status = 'running', updatedAt = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(Date.now(), row.id)
    if (result.changes !== 1) return undefined
    return rowToPrompt(getPromptRow(row.id)!)
  })()
}

export function cancelStaleSessionPrompts(sessionId: string, contextEpoch: number): number {
  const normalizedSessionId = requireText(sessionId, 'Session id')
  const normalizedEpoch = normalizeContextEpoch(contextEpoch)
  const result = getDb()
    .prepare(
      `UPDATE session_prompt_inbox
       SET status = 'cancelled', updatedAt = ?
       WHERE sessionId = ? AND status IN ('pending', 'running') AND contextEpoch <> ?`
    )
    .run(Date.now(), normalizedSessionId, normalizedEpoch)
  return result.changes
}

export function completeSessionPrompt(id: string): boolean {
  return finishSessionPrompt(id, 'completed')
}

export function cancelSessionPrompt(id: string): boolean {
  const normalizedId = requireText(id, 'Prompt admission id')
  const result = getDb()
    .prepare(
      `UPDATE session_prompt_inbox
       SET status = 'cancelled', updatedAt = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(Date.now(), normalizedId)
  return result.changes === 1
}

export function finishSessionPrompt(
  id: string,
  status: Extract<SessionPromptAdmissionStatus, 'completed' | 'cancelled'>
): boolean {
  const normalizedId = requireText(id, 'Prompt admission id')
  const result = getDb()
    .prepare(
      `UPDATE session_prompt_inbox
       SET status = ?, updatedAt = ?
       WHERE id = ? AND status IN ('pending', 'running')`
    )
    .run(status, Date.now(), normalizedId)
  return result.changes === 1
}

export function requeueSessionPrompts(ids: string[]): number {
  const normalizedIds = Array.from(
    new Set(ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
  )
  if (normalizedIds.length === 0) return 0
  const database = getDb()
  const update = database.prepare(
    `UPDATE session_prompt_inbox
     SET status = 'pending', updatedAt = ?
     WHERE id = ? AND status = 'running'`
  )
  return database.transaction((): number => {
    let changed = 0
    const now = Date.now()
    for (const id of normalizedIds) changed += update.run(now, id).changes
    return changed
  })()
}

/** Recover prompts claimed by a process that exited before completing their run. */
export function recoverRunningSessionPrompts(): number {
  const result = getDb()
    .prepare(
      `UPDATE session_prompt_inbox
       SET status = 'pending', updatedAt = ?
       WHERE status = 'running'`
    )
    .run(Date.now())
  return result.changes
}
