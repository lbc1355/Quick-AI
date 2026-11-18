import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Message, Session, SessionRevertState } from '../../shared/types'
import { isBackgroundResultSourceMessage } from '../../shared/backgroundResultSource'
import { compactAgentEvents } from '../../shared/agentEventCompactor'
import { loadSessionAgentEventJournals } from '../agent/agentEventJournal'
import { mergeAgentEventJournalsIntoSessions } from '../agent/agentEventRecovery'
import { discardBackgroundJobsForSession } from '../agent/backgroundJobManager'
import { normalizeContextEpoch } from '../../shared/contextEpoch'
import { normalizeReasoningPreference } from '../../shared/reasoningControl'
import { getDb } from './connection'

/**
 * Delete rows that reference a session from tables that have no foreign-key cascade. Without this,
 * deleting a session (or a folder project containing it) leaves orphaned prompt-inbox and
 * background-job rows behind. Running background jobs are cancelled first so they do not keep
 * executing and re-insert their row (via the persistence save) after this delete.
 */
export function deleteSessionScopedRows(database: Database.Database, sessionId: string): void {
  database.prepare('DELETE FROM session_prompt_inbox WHERE sessionId = ?').run(sessionId)
  discardBackgroundJobsForSession(sessionId)
  database.prepare('DELETE FROM background_jobs WHERE sessionId = ?').run(sessionId)
}

export function loadSessions(): Session[] {
  const database = getDb()

  const sessionRows = database
    .prepare(
      'SELECT id, title, titleManuallyEdited, lastActiveTime, contextEpoch, projectId, branchOf, revertState, reasoningPreference FROM sessions ORDER BY lastActiveTime DESC'
    )
    .all() as Array<{
    id: string
    title: string
    titleManuallyEdited: number
    lastActiveTime: number
    contextEpoch: number
    projectId: string | null
    branchOf: string | null
    revertState: string | null
    reasoningPreference: string | null
  }>

  // Bulk-load every message and file in two queries, then group in memory. The previous
  // approach issued one query per session plus one per message (an N+1 fan-out), so startup
  // cost grew with total message count; this keeps it to a constant number of round-trips.
  const allMsgRows = database
    .prepare(
      'SELECT id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, isSynthetic, isInternal, tokenSpeed, cacheStats, errorPayload, createdAt FROM messages ORDER BY createdAt ASC'
    )
    .all() as Array<{
    id: string
    sessionId: string
    role: Message['role']
    content: string
    reasoning_content: string | null
    agentRunId: string | null
    agentRunIds: string | null
    agentEvents: string | null
    forkedFrom: string | null
    isBranchFork: number | null
    isSynthetic: number
    isInternal: number
    tokenSpeed: number | null
    cacheStats: string | null
    errorPayload: string | null
    createdAt: number
  }>

  const allFileRows = database
    .prepare('SELECT messageId, name, content, type FROM message_files')
    .all() as Array<{
    messageId: string
    name: string
    content: string
    type: string
  }>

  const filesByMessage = new Map<string, Array<{ name: string; content: string; type: string }>>()
  for (const f of allFileRows) {
    const list = filesByMessage.get(f.messageId)
    const entry = { name: f.name, content: f.content, type: f.type }
    if (list) list.push(entry)
    else filesByMessage.set(f.messageId, [entry])
  }

  const messagesBySession = new Map<string, Message[]>()
  for (const m of allMsgRows) {
    let agentEvents = undefined
    if (m.agentEvents) {
      try {
        agentEvents = JSON.parse(m.agentEvents)
      } catch {
        // ignore
      }
    }

    const forkedFrom = parseBranchRef(m.forkedFrom)
    const fileRows = filesByMessage.get(m.id)
    let cacheStats = undefined
    if (m.cacheStats) {
      try {
        cacheStats = JSON.parse(m.cacheStats)
      } catch {
        // ignore
      }
    }

    let errorPayload = undefined
    if (m.errorPayload) {
      try {
        errorPayload = JSON.parse(m.errorPayload)
      } catch {
        // ignore
      }
    }

    // Older rows lost both flags, but the generated user prompt still has its reserved ID.
    const backgroundSource = isBackgroundResultSourceMessage(m)
    const message: Message = {
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning_content: m.reasoning_content || undefined,
      agentRunId: m.agentRunId || undefined,
      agentRunIds: parseRunIds(m.agentRunIds, m.agentRunId),
      agentEvents,
      forkedFrom,
      isBranchFork: m.isBranchFork === 1 || (m.isBranchFork == null && !!forkedFrom) || undefined,
      isSynthetic: m.isSynthetic === 1 || backgroundSource || undefined,
      isInternal: m.isInternal === 1 || backgroundSource || undefined,
      files: fileRows && fileRows.length > 0 ? fileRows : undefined,
      tokenSpeed: m.tokenSpeed || undefined,
      cacheStats,
      errorPayload
    }

    const list = messagesBySession.get(m.sessionId)
    if (list) list.push(message)
    else messagesBySession.set(m.sessionId, [message])
  }

  const sessions = sessionRows.map((s) => ({
    id: s.id,
    title: s.title,
    titleManuallyEdited: s.titleManuallyEdited === 1 || undefined,
    lastActiveTime: s.lastActiveTime || undefined,
    contextEpoch: normalizeContextEpoch(s.contextEpoch),
    projectId: s.projectId || undefined,
    branchOf: parseBranchRef(s.branchOf),
    revert: parseSessionRevertState(s.revertState),
    ...(s.reasoningPreference
      ? { reasoningPreference: normalizeReasoningPreference(s.reasoningPreference) }
      : {}),
    messages: messagesBySession.get(s.id) || []
  }))
  const eventJournals = sessions.flatMap((session) => loadSessionAgentEventJournals(session.id))
  return mergeAgentEventJournalsIntoSessions(sessions, eventJournals)
}

export function listSessionFileRestorePoints(): Array<{
  sessionId: string
  restorePoint: NonNullable<SessionRevertState['fileRestorePoint']>
}> {
  const rows = getDb()
    .prepare('SELECT id, revertState FROM sessions WHERE revertState IS NOT NULL')
    .all() as Array<{ id: string; revertState: string }>

  return rows.flatMap((row) => {
    const revert = parseSessionRevertState(row.revertState)
    const restorePoint = revert?.fileRestorePoint
    if (
      !restorePoint ||
      typeof restorePoint.projectRoot !== 'string' ||
      !/^[a-f0-9]{40,64}$/i.test(restorePoint.tree)
    ) {
      return []
    }
    return [{ sessionId: row.id, restorePoint }]
  })
}

function parseSessionRevertState(value: string | null): SessionRevertState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<SessionRevertState>
    if (
      typeof parsed.boundaryMessageId !== 'string' ||
      !Array.isArray(parsed.revertedMessages) ||
      !Array.isArray(parsed.runIds) ||
      typeof parsed.revertedAt !== 'number'
    ) {
      return undefined
    }
    return parsed as SessionRevertState
  } catch {
    return undefined
  }
}

/** Parse a JSON-serialised branch reference column back into its typed shape (null/garbage → undefined). */
function parseBranchRef(value: string | null): Session['branchOf'] {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as {
      sessionId?: unknown
      messageId?: unknown
      runId?: unknown
    }
    if (typeof parsed?.sessionId === 'string' && typeof parsed?.messageId === 'string') {
      return {
        sessionId: parsed.sessionId,
        messageId: parsed.messageId,
        ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {})
      }
    }
  } catch {
    // ignore malformed JSON
  }
  return undefined
}

function parseRunIds(value: string | null, fallbackRunId: string | null): string[] | undefined {
  const fallback = fallbackRunId ? [fallbackRunId] : []
  if (!value) return fallback.length > 0 ? fallback : undefined

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return fallback.length > 0 ? fallback : undefined
    const ids = Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string')))
    return ids.length > 0 ? ids : fallback.length > 0 ? fallback : undefined
  } catch {
    return fallback.length > 0 ? fallback : undefined
  }
}

function serializeAgentEvents(events: Message['agentEvents']): string | null {
  if (!events || events.length === 0) return null
  const compacted = compactAgentEvents(events)
  return compacted.length > 0 ? JSON.stringify(compacted) : null
}

/**
 * Stable content hash of everything saveSessions() persists for a single session. Two snapshots
 * of the same session that hash equal are byte-identical on disk, so the row can be skipped. The
 * normalized shape mirrors the persisted columns (missing/undefined fields collapse to the same
 * canonical value) so cosmetic in-memory differences never trigger a needless rewrite.
 */
export function computeSessionHash(session: Session): string {
  const normalized = {
    id: session.id,
    title: session.title,
    titleManuallyEdited: session.titleManuallyEdited ? 1 : 0,
    lastActiveTime: session.lastActiveTime || 0,
    contextEpoch: normalizeContextEpoch(session.contextEpoch),
    projectId: session.projectId || null,
    branchOf: session.branchOf ?? null,
    revert: session.revert ?? null,
    reasoningPreference: session.reasoningPreference
      ? normalizeReasoningPreference(session.reasoningPreference)
      : null,
    messages: (session.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      reasoning_content: m.reasoning_content || null,
      agentRunId: m.agentRunId || null,
      agentRunIds: m.agentRunIds || (m.agentRunId ? [m.agentRunId] : []),
      agentEvents: serializeAgentEvents(m.agentEvents),
      forkedFrom: m.forkedFrom ?? null,
      isBranchFork: m.isBranchFork ? 1 : 0,
      // Omitting flags at their defaults keeps existing hashes for unchanged ordinary messages.
      isSynthetic: m.isSynthetic === true || undefined,
      isInternal: m.isInternal === true || undefined,
      tokenSpeed: m.tokenSpeed || null,
      cacheStats: m.cacheStats ?? null,
      errorPayload: m.errorPayload ? JSON.stringify(m.errorPayload) : null,
      files: (m.files ?? []).map((f) => ({ name: f.name, content: f.content, type: f.type }))
    }))
  }
  return createHash('sha1').update(JSON.stringify(normalized)).digest('hex')
}

export interface SessionPersistPlan {
  /** Sessions that changed (or are new) and must be rewritten, paired with their fresh hash. */
  upserts: Array<{ session: Session; hash: string }>
  /** Session ids present in the DB but absent from the snapshot — delete them (cascades). */
  deleteIds: string[]
}

/**
 * Pure diff between the hashes already on disk and the incoming snapshot. Extracted from
 * saveSessions() so it can be unit-tested without an Electron/SQLite environment.
 */
export function planSessionPersist(
  existingHashes: Map<string, string | null>,
  sessions: Session[]
): SessionPersistPlan {
  const incomingIds = new Set<string>()
  const upserts: SessionPersistPlan['upserts'] = []

  for (const session of sessions) {
    incomingIds.add(session.id)
    const hash = computeSessionHash(session)
    if (existingHashes.get(session.id) !== hash) {
      upserts.push({ session, hash })
    }
  }

  const deleteIds: string[] = []
  for (const id of existingHashes.keys()) {
    if (!incomingIds.has(id)) deleteIds.push(id)
  }

  return { upserts, deleteIds }
}

export function saveSessions(sessions: Session[]): void {
  const database = getDb()

  const existingRows = database.prepare('SELECT id, contentHash FROM sessions').all() as Array<{
    id: string
    contentHash: string | null
  }>
  const existingHashes = new Map(existingRows.map((r) => [r.id, r.contentHash]))
  const plan = planSessionPersist(existingHashes, sessions)

  // Nothing changed since the last save — skip the transaction (and its fsync) entirely.
  if (plan.upserts.length === 0 && plan.deleteIds.length === 0) return

  const insertSession = database.prepare(
    'INSERT OR REPLACE INTO sessions (id, title, titleManuallyEdited, lastActiveTime, contextEpoch, projectId, branchOf, revertState, reasoningPreference, contentHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?')
  const deleteMessages = database.prepare('DELETE FROM messages WHERE sessionId = ?')
  const insertMessage = database.prepare(
    `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, isSynthetic, isInternal, tokenSpeed, cacheStats, errorPayload, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertFile = database.prepare(
    'INSERT INTO message_files (messageId, name, content, type) VALUES (?, ?, ?, ?)'
  )

  // One transaction for the whole diff. Only changed/removed sessions are touched, so a quiet
  // save (e.g. switching sessions with no edits) is a no-op and an active run rewrites just the
  // one session that grew — instead of the previous delete-all + full reinsert of every session.
  const persist = database.transaction((currentPlan: SessionPersistPlan) => {
    // Sessions removed from the snapshot (cascade deletes their messages and files; the
    // prompt-inbox and background-job rows are cleaned up explicitly — no FK cascade exists).
    for (const id of currentPlan.deleteIds) {
      deleteSession.run(id)
      deleteSessionScopedRows(database, id)
    }

    for (const { session, hash } of currentPlan.upserts) {
      insertSession.run(
        session.id,
        session.title,
        session.titleManuallyEdited ? 1 : 0,
        session.lastActiveTime || 0,
        normalizeContextEpoch(session.contextEpoch),
        session.projectId || null,
        session.branchOf ? JSON.stringify(session.branchOf) : null,
        session.revert ? JSON.stringify(session.revert) : null,
        session.reasoningPreference
          ? normalizeReasoningPreference(session.reasoningPreference)
          : null,
        hash
      )

      // Rewrite only this session's messages. INSERT OR REPLACE on the session PK already
      // cascade-deletes existing rows, but the explicit delete keeps behaviour obvious and
      // correct regardless of REPLACE semantics.
      deleteMessages.run(session.id)

      if (session.messages) {
        for (const msg of session.messages) {
          insertMessage.run(
            msg.id,
            session.id,
            msg.role,
            msg.content || '',
            msg.reasoning_content || null,
            msg.agentRunId || null,
            JSON.stringify(msg.agentRunIds || (msg.agentRunId ? [msg.agentRunId] : [])),
            serializeAgentEvents(msg.agentEvents),
            msg.forkedFrom ? JSON.stringify(msg.forkedFrom) : null,
            msg.isBranchFork ? 1 : 0,
            msg.isSynthetic === true ? 1 : 0,
            msg.isInternal === true ? 1 : 0,
            msg.tokenSpeed || null,
            msg.cacheStats ? JSON.stringify(msg.cacheStats) : null,
            msg.errorPayload ? JSON.stringify(msg.errorPayload) : null,
            parseInt(msg.id) || Date.now()
          )
          if (msg.files && msg.files.length > 0) {
            for (const f of msg.files) {
              insertFile.run(msg.id, f.name, f.content, f.type)
            }
          }
        }
      }
    }
  })
  persist(plan)
}
