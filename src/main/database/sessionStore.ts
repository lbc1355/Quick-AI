import { Message, Session } from '../../shared/types'
import { compactAgentEvents } from '../../shared/agentEventCompactor'
import { getDb } from './connection'

export function loadSessions(): Session[] {
  const database = getDb()

  const sessionRows = database
    .prepare(
      'SELECT id, title, lastActiveTime, projectId, branchOf FROM sessions ORDER BY lastActiveTime DESC'
    )
    .all() as Array<{
    id: string
    title: string
    lastActiveTime: number
    projectId: string | null
    branchOf: string | null
  }>

  // Bulk-load every message and file in two queries, then group in memory. The previous
  // approach issued one query per session plus one per message (an N+1 fan-out), so startup
  // cost grew with total message count; this keeps it to a constant number of round-trips.
  const allMsgRows = database
    .prepare(
      'SELECT id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, tokenSpeed, cacheStats, createdAt FROM messages ORDER BY createdAt ASC'
    )
    .all() as Array<{
    id: string
    sessionId: string
    role: string
    content: string
    reasoning_content: string | null
    agentRunId: string | null
    agentRunIds: string | null
    agentEvents: string | null
    forkedFrom: string | null
    isBranchFork: number | null
    tokenSpeed: number | null
    cacheStats: string | null
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

    const message: Message = {
      id: m.id,
      role: m.role as Message['role'],
      content: m.content,
      reasoning_content: m.reasoning_content || undefined,
      agentRunId: m.agentRunId || undefined,
      agentRunIds: parseRunIds(m.agentRunIds, m.agentRunId),
      agentEvents,
      forkedFrom,
      isBranchFork: m.isBranchFork === 1 || (m.isBranchFork == null && !!forkedFrom) || undefined,
      files: fileRows && fileRows.length > 0 ? fileRows : undefined,
      tokenSpeed: m.tokenSpeed || undefined,
      cacheStats
    }

    const list = messagesBySession.get(m.sessionId)
    if (list) list.push(message)
    else messagesBySession.set(m.sessionId, [message])
  }

  return sessionRows.map((s) => ({
    id: s.id,
    title: s.title,
    lastActiveTime: s.lastActiveTime || undefined,
    projectId: s.projectId || undefined,
    branchOf: parseBranchRef(s.branchOf),
    messages: messagesBySession.get(s.id) || []
  }))
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

export function saveSessions(sessions: Session[]): void {
  const database = getDb()

  const deleteSessions = database.prepare('DELETE FROM sessions')
  const insertSession = database.prepare(
    'INSERT OR REPLACE INTO sessions (id, title, lastActiveTime, projectId, branchOf) VALUES (?, ?, ?, ?, ?)'
  )
  const insertMessage = database.prepare(
    `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, tokenSpeed, cacheStats, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertFile = database.prepare(
    'INSERT INTO message_files (messageId, name, content, type) VALUES (?, ?, ?, ?)'
  )

  // One transaction for the entire snapshot. Without this, the delete-all plus the hundreds
  // of per-message/per-file inserts each commit (and fsync under WAL) independently — orders
  // of magnitude slower — and a crash mid-loop could leave every session wiped.
  const persist = database.transaction((sessionList: Session[]) => {
    // Delete all existing sessions (cascade deletes messages and files)
    deleteSessions.run()

    for (const session of sessionList) {
      insertSession.run(
        session.id,
        session.title,
        session.lastActiveTime || 0,
        session.projectId || null,
        session.branchOf ? JSON.stringify(session.branchOf) : null
      )

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
            msg.tokenSpeed || null,
            msg.cacheStats ? JSON.stringify(msg.cacheStats) : null,
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
  persist(sessions)
}
