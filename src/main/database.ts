import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { readFileSync, existsSync, renameSync, readdirSync, unlinkSync } from 'fs'
import {
  StorageSchema,
  Session,
  Message,
  Skill,
  Memory,
  UserMemory,
  AppSettings,
  ApiProvider,
  SessionResourceChunk
} from '../shared/types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'quickai.db')
  db = new Database(dbPath)

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -8000') // 8MB cache

  createSchema(db)
  migrateFromJson(db, dataDir)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      apiKey     TEXT NOT NULL DEFAULT '',
      apiUrl     TEXT NOT NULL,
      model      TEXT NOT NULL,
      modelsList TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      lastActiveTime INTEGER NOT NULL DEFAULT 0,
      branchOf       TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY,
      sessionId         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role              TEXT NOT NULL,
      content           TEXT NOT NULL DEFAULT '',
      reasoning_content TEXT,
      agentRunId        TEXT,
      agentRunIds       TEXT DEFAULT '[]',
      agentEvents       TEXT,
      forkedFrom        TEXT,
      isBranchFork      INTEGER NOT NULL DEFAULT 0,
      createdAt         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId);

    CREATE TABLE IF NOT EXISTS message_files (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      name      TEXT NOT NULL,
      content   TEXT NOT NULL,
      type      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_files_message ON message_files(messageId);

    CREATE TABLE IF NOT EXISTS skills (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      trigger       TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      description   TEXT DEFAULT '',
      triggers      TEXT DEFAULT '[]',
      mode          TEXT DEFAULT 'insert',
      kind          TEXT DEFAULT 'prompt',
      tools         TEXT DEFAULT '[]',
      maxSteps      INTEGER DEFAULT 30,
      rawMarkdown   TEXT,
      source        TEXT DEFAULT 'manual',
      entryPath     TEXT,
      packageRoot   TEXT,
      packageFiles  TEXT DEFAULT '[]',
      installedAt   INTEGER,
      updatedAt     INTEGER,
      toolDiscovery TEXT DEFAULT 'static'
    );

    CREATE TABLE IF NOT EXISTS memories (
      id        TEXT PRIMARY KEY,
      content   TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memories (
      id        TEXT PRIMARY KEY,
      scope     TEXT NOT NULL DEFAULT 'global',
      sessionId TEXT,
      category  TEXT NOT NULL DEFAULT 'general',
      content   TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_memories_scope ON user_memories(scope);
    CREATE INDEX IF NOT EXISTS idx_user_memories_session ON user_memories(sessionId);

    CREATE TABLE IF NOT EXISTS resource_cache (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      source        TEXT NOT NULL,
      title         TEXT,
      fingerprint   TEXT,
      totalChars    INTEGER,
      fetchedRanges TEXT DEFAULT '[]',
      nextOffset    INTEGER,
      status        TEXT NOT NULL DEFAULT 'partial',
      summary       TEXT,
      createdAt     INTEGER NOT NULL,
      updatedAt     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resource_chunks (
      id         TEXT NOT NULL,
      resourceId TEXT NOT NULL REFERENCES resource_cache(id) ON DELETE CASCADE,
      offset     INTEGER,
      endOffset  INTEGER,
      page       INTEGER,
      section    TEXT,
      text       TEXT,
      summary    TEXT,
      createdAt  INTEGER NOT NULL,
      PRIMARY KEY (resourceId, id)
    );

    CREATE TABLE IF NOT EXISTS resource_links (
      resourceId TEXT NOT NULL REFERENCES resource_cache(id) ON DELETE CASCADE,
      linkId     INTEGER NOT NULL,
      text       TEXT NOT NULL,
      href       TEXT NOT NULL,
      PRIMARY KEY (resourceId, linkId)
    );
  `)

  // Additive column migrations for databases created before a column existed. CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so older DBs are missing these and would
  // silently drop the data on save (e.g. branch/fork metadata vanishing after a restart).
  ensureColumn(database, 'sessions', 'branchOf', 'TEXT')
  ensureColumn(database, 'messages', 'forkedFrom', 'TEXT')
  ensureColumn(database, 'messages', 'isBranchFork', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(database, 'messages', 'agentRunIds', "TEXT DEFAULT '[]'")
  ensureColumn(database, 'skills', 'entryPath', 'TEXT')
  ensureColumn(database, 'skills', 'packageRoot', 'TEXT')
  ensureColumn(database, 'skills', 'packageFiles', "TEXT DEFAULT '[]'")
}

/** Add a column to an existing table if it is missing. Idempotent; safe to call on every boot. */
function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

// ── Migration from old JSON files ────────────────────────────────────────

function migrateFromJson(database: Database.Database, dataDir: string): void {
  const storePath = join(dataDir, 'quickai_store.json')
  const resourcesDir = join(dataDir, 'resources')

  // Only migrate if we have old data AND the database is empty
  const hasOldStore = existsSync(storePath)
  const hasOldResources = existsSync(resourcesDir)

  if (!hasOldStore && !hasOldResources) return

  // Check if migration already happened
  const count = database.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number }
  if (count.c > 0) return // Already migrated

  if (hasOldStore) {
    migrateStore(database, storePath)
  }

  if (hasOldResources) {
    migrateResources(database, resourcesDir)
  }
}

function migrateStore(database: Database.Database, storePath: string): void {
  console.log('[database] Migrating quickai_store.json → SQLite...')
  try {
    const raw = readFileSync(storePath, 'utf-8')
    const data: StorageSchema = JSON.parse(raw)

    // ── Settings ──
    const settings = data.settings
    if (settings) {
      const insertSetting = database.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      )
      insertSetting.run('systemPrompt', settings.systemPrompt || '')
      insertSetting.run('autoHideOnBlur', String(settings.autoHideOnBlur ?? true))
      insertSetting.run('theme', settings.theme || 'dark')
      insertSetting.run('activeProviderId', settings.activeProviderId || '')

      if (settings.permissions) {
        insertSetting.run('permissions', JSON.stringify(settings.permissions))
      }

      // ── Providers ──
      if (settings.providers && settings.providers.length > 0) {
        const insertProvider = database.prepare(
          `INSERT OR REPLACE INTO providers (id, name, type, apiKey, apiUrl, model, modelsList)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        for (const p of settings.providers) {
          insertProvider.run(
            p.id,
            p.name,
            p.type || 'custom',
            p.apiKey || '',
            p.apiUrl,
            p.model,
            JSON.stringify(p.modelsList || [])
          )
        }
      }
    }

    // ── Sessions & Messages ──
    if (data.sessions && data.sessions.length > 0) {
      const insertSession = database.prepare(
        'INSERT OR REPLACE INTO sessions (id, title, lastActiveTime) VALUES (?, ?, ?)'
      )
      const insertMessage = database.prepare(
        `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertFile = database.prepare(
        'INSERT INTO message_files (messageId, name, content, type) VALUES (?, ?, ?, ?)'
      )

      for (const session of data.sessions) {
        insertSession.run(session.id, session.title, session.lastActiveTime || 0)

        if (session.messages && session.messages.length > 0) {
          for (const msg of session.messages) {
            insertMessage.run(
              msg.id,
              session.id,
              msg.role,
              msg.content || '',
              msg.reasoning_content || null,
              msg.agentRunId || null,
              JSON.stringify(msg.agentRunIds || (msg.agentRunId ? [msg.agentRunId] : [])),
              msg.agentEvents ? JSON.stringify(msg.agentEvents) : null,
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
    }

    // ── Skills ──
    if (data.skills && data.skills.length > 0) {
      const insertSkill = database.prepare(
        `INSERT OR REPLACE INTO skills
         (id, name, trigger, prompt, description, triggers, mode, kind, tools, maxSteps, rawMarkdown, source, entryPath, packageRoot, packageFiles, installedAt, updatedAt, toolDiscovery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const s of data.skills) {
        insertSkill.run(
          s.id,
          s.name,
          s.trigger,
          s.prompt,
          s.description || '',
          JSON.stringify(s.triggers || []),
          s.mode || 'insert',
          s.kind || 'prompt',
          JSON.stringify(s.tools || []),
          s.maxSteps ?? 30,
          s.rawMarkdown || null,
          s.source || 'manual',
          s.entryPath || null,
          s.packageRoot || null,
          JSON.stringify(s.packageFiles || []),
          s.installedAt || null,
          s.updatedAt || null,
          s.toolDiscovery || 'static'
        )
      }
    }

    // ── Memories ──
    if (data.memories && data.memories.length > 0) {
      const insertMemory = database.prepare(
        'INSERT OR REPLACE INTO memories (id, content, createdAt) VALUES (?, ?, ?)'
      )
      for (const m of data.memories) {
        insertMemory.run(m.id, m.content, m.createdAt)
      }
    }

    // Rename old store to .bak
    const bakPath = storePath + '.bak'
    if (existsSync(bakPath)) unlinkSync(bakPath)
    renameSync(storePath, bakPath)
    console.log('[database] Migration from quickai_store.json complete. Backup saved as .bak')
  } catch (err) {
    console.error('[database] Failed to migrate quickai_store.json:', err)
  }
}

function migrateResources(database: Database.Database, resourcesDir: string): void {
  console.log('[database] Migrating resources/ → SQLite...')
  try {
    const files = readdirSync(resourcesDir).filter((f) => f.endsWith('.json'))
    const insertCache = database.prepare(
      `INSERT OR REPLACE INTO resource_cache
       (id, kind, source, title, fingerprint, totalChars, fetchedRanges, nextOffset, status, summary, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertChunk = database.prepare(
      `INSERT OR REPLACE INTO resource_chunks
       (id, resourceId, offset, endOffset, page, section, text, summary, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const file of files) {
      const filePath = join(resourcesDir, file)
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw)

        const resourceId = data.id || file.replace('.json', '')
        insertCache.run(
          resourceId,
          data.kind || 'web',
          data.source || '',
          data.title || null,
          data.fingerprint || null,
          data.totalChars ?? null,
          JSON.stringify(data.fetchedRanges || []),
          data.nextOffset ?? null,
          data.status || 'partial',
          data.summary || null,
          data.createdAt || Date.now(),
          data.updatedAt || Date.now()
        )

        if (data.chunks && Array.isArray(data.chunks)) {
          for (const chunk of data.chunks) {
            insertChunk.run(
              chunk.id,
              resourceId,
              chunk.offset ?? null,
              chunk.endOffset ?? null,
              chunk.page ?? null,
              chunk.section || null,
              chunk.text || null,
              chunk.summary || null,
              chunk.createdAt || Date.now()
            )
          }
        }

        // Rename to .bak
        const bakPath = filePath + '.bak'
        if (existsSync(bakPath)) unlinkSync(bakPath)
        renameSync(filePath, bakPath)
      } catch (err) {
        console.error(`[database] Failed to migrate resource file ${file}:`, err)
      }
    }

    console.log('[database] Migration from resources/ complete. Backups saved as .bak')
  } catch (err) {
    console.error('[database] Failed to migrate resources/:', err)
  }
}

// ── Store CRUD helpers ──────────────────────────────────────────────────

// Settings

export function loadSettings(): AppSettings {
  const database = getDb()

  const kvRows = database.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const kv: Record<string, string> = {}
  for (const row of kvRows) {
    kv[row.key] = row.value
  }

  const providers = database.prepare('SELECT * FROM providers').all() as Array<{
    id: string
    name: string
    type: string
    apiKey: string
    apiUrl: string
    model: string
    modelsList: string
  }>

  let permissions: { [toolName: string]: 'allow' | 'ask' | 'deny' } = {}
  try {
    permissions = JSON.parse(kv['permissions'] || '{}')
  } catch {
    // ignore
  }

  return {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as ApiProvider['type'],
      apiKey: p.apiKey,
      apiUrl: p.apiUrl,
      model: p.model,
      modelsList: JSON.parse(p.modelsList || '[]')
    })),
    activeProviderId: kv['activeProviderId'] || '',
    systemPrompt: kv['systemPrompt'] || '',
    autoHideOnBlur: kv['autoHideOnBlur'] !== 'false',
    theme: (kv['theme'] as 'dark' | 'light') || 'dark',
    permissions
  }
}

export function saveSettings(settings: AppSettings): void {
  const database = getDb()
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

  upsert.run('systemPrompt', settings.systemPrompt)
  upsert.run('autoHideOnBlur', String(settings.autoHideOnBlur))
  upsert.run('theme', settings.theme || 'dark')
  upsert.run('activeProviderId', settings.activeProviderId)
  upsert.run('permissions', JSON.stringify(settings.permissions || {}))

  // Providers: delete all then re-insert
  database.prepare('DELETE FROM providers').run()
  const insert = database.prepare(
    'INSERT OR REPLACE INTO providers (id, name, type, apiKey, apiUrl, model, modelsList) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  for (const p of settings.providers) {
    insert.run(p.id, p.name, p.type, p.apiKey || '', p.apiUrl, p.model, JSON.stringify(p.modelsList || []))
  }
}

// Sessions

export function loadSessions(): Session[] {
  const database = getDb()

  const sessionRows = database
    .prepare('SELECT id, title, lastActiveTime, branchOf FROM sessions ORDER BY lastActiveTime DESC')
    .all() as Array<{
    id: string
    title: string
    lastActiveTime: number
    branchOf: string | null
  }>

  const msgStmt = database.prepare(
    'SELECT id, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, createdAt FROM messages WHERE sessionId = ? ORDER BY createdAt ASC'
  )
  const fileStmt = database.prepare(
    'SELECT name, content, type FROM message_files WHERE messageId = ?'
  )

  return sessionRows.map((s) => {
    const msgRows = msgStmt.all(s.id) as Array<{
      id: string
      role: string
      content: string
      reasoning_content: string | null
      agentRunId: string | null
      agentRunIds: string | null
      agentEvents: string | null
      forkedFrom: string | null
      isBranchFork: number | null
      createdAt: number
    }>

    const messages: Message[] = msgRows.map((m) => {
      const fileRows = fileStmt.all(m.id) as Array<{
        name: string
        content: string
        type: string
      }>

      let agentEvents = undefined
      if (m.agentEvents) {
        try {
          agentEvents = JSON.parse(m.agentEvents)
        } catch {
          // ignore
        }
      }

      const forkedFrom = parseBranchRef(m.forkedFrom)

      return {
        id: m.id,
        role: m.role as Message['role'],
        content: m.content,
        reasoning_content: m.reasoning_content || undefined,
        agentRunId: m.agentRunId || undefined,
        agentRunIds: parseRunIds(m.agentRunIds, m.agentRunId),
        agentEvents,
        forkedFrom,
        isBranchFork: m.isBranchFork === 1 || (m.isBranchFork == null && !!forkedFrom) || undefined,
        files:
          fileRows.length > 0
            ? fileRows.map((f) => ({ name: f.name, content: f.content, type: f.type }))
            : undefined
      }
    })

    return {
      id: s.id,
      title: s.title,
      lastActiveTime: s.lastActiveTime || undefined,
      branchOf: parseBranchRef(s.branchOf),
      messages
    }
  })
}

/** Parse a JSON-serialised branch reference column back into its typed shape (null/garbage → undefined). */
function parseBranchRef(value: string | null): Session['branchOf'] {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as { sessionId?: unknown; messageId?: unknown; runId?: unknown }
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

export function saveSessions(sessions: Session[]): void {
  const database = getDb()

  // Delete all existing sessions (cascade deletes messages and files)
  database.prepare('DELETE FROM sessions').run()

  const insertSession = database.prepare(
    'INSERT OR REPLACE INTO sessions (id, title, lastActiveTime, branchOf) VALUES (?, ?, ?, ?)'
  )
  const insertMessage = database.prepare(
    `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, forkedFrom, isBranchFork, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertFile = database.prepare(
    'INSERT INTO message_files (messageId, name, content, type) VALUES (?, ?, ?, ?)'
  )

  for (const session of sessions) {
    insertSession.run(
      session.id,
      session.title,
      session.lastActiveTime || 0,
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
          msg.agentEvents ? JSON.stringify(msg.agentEvents) : null,
          msg.forkedFrom ? JSON.stringify(msg.forkedFrom) : null,
          msg.isBranchFork ? 1 : 0,
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
}

// Skills

export function loadSkills(): Skill[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM skills').all() as Array<{
    id: string
    name: string
    trigger: string
    prompt: string
    description: string
    triggers: string
    mode: string
    kind: string
    tools: string
    maxSteps: number
    rawMarkdown: string | null
    source: string
    entryPath: string | null
    packageRoot: string | null
    packageFiles: string | null
    installedAt: number | null
    updatedAt: number | null
    toolDiscovery: string
  }>

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    prompt: r.prompt,
    description: r.description || undefined,
    triggers: JSON.parse(r.triggers || '[]'),
    mode: r.mode as Skill['mode'],
    kind: r.kind as Skill['kind'],
    tools: JSON.parse(r.tools || '[]'),
    maxSteps: r.maxSteps ?? undefined,
    rawMarkdown: r.rawMarkdown || undefined,
    source: r.source as Skill['source'],
    entryPath: r.entryPath || undefined,
    packageRoot: r.packageRoot || undefined,
    packageFiles: parseSkillPackageFiles(r.packageFiles),
    installedAt: r.installedAt ?? undefined,
    updatedAt: r.updatedAt ?? undefined,
    toolDiscovery: r.toolDiscovery as Skill['toolDiscovery']
  }))
}

function parseSkillPackageFiles(value: string | null): Skill['packageFiles'] {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return undefined

    const files = parsed
      .map((file) => {
        if (!file || typeof file !== 'object') return undefined
        const candidate = file as { path?: unknown; content?: unknown; size?: unknown }
        if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') {
          return undefined
        }
        return {
          path: candidate.path,
          content: candidate.content,
          size: typeof candidate.size === 'number' ? candidate.size : candidate.content.length
        }
      })
      .filter((file): file is NonNullable<Skill['packageFiles']>[number] => !!file)

    return files.length > 0 ? files : undefined
  } catch {
    return undefined
  }
}

export function saveSkills(skills: Skill[]): void {
  const database = getDb()
  database.prepare('DELETE FROM skills').run()
  const insert = database.prepare(
    `INSERT OR REPLACE INTO skills
     (id, name, trigger, prompt, description, triggers, mode, kind, tools, maxSteps, rawMarkdown, source, entryPath, packageRoot, packageFiles, installedAt, updatedAt, toolDiscovery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const s of skills) {
    insert.run(
      s.id,
      s.name,
      s.trigger,
      s.prompt,
      s.description || '',
      JSON.stringify(s.triggers || []),
      s.mode || 'insert',
      s.kind || 'prompt',
      JSON.stringify(s.tools || []),
      s.maxSteps ?? 30,
      s.rawMarkdown || null,
      s.source || 'manual',
      s.entryPath || null,
      s.packageRoot || null,
      JSON.stringify(s.packageFiles || []),
      s.installedAt || null,
      s.updatedAt || null,
      s.toolDiscovery || 'static'
    )
  }
}

// Memories

export function loadMemories(): Memory[] {
  const database = getDb()
  return database
    .prepare('SELECT id, content, createdAt FROM memories ORDER BY createdAt DESC')
    .all() as Memory[]
}

export function saveMemories(memories: Memory[]): void {
  const database = getDb()
  database.prepare('DELETE FROM memories').run()
  const insert = database.prepare(
    'INSERT OR REPLACE INTO memories (id, content, createdAt) VALUES (?, ?, ?)'
  )
  for (const m of memories) {
    insert.run(m.id, m.content, m.createdAt)
  }
}

// ── User Memories CRUD helpers (layered: global / session) ───────────────

const rowToUserMemory = (r: {
  id: string
  scope: string
  sessionId: string | null
  category: string
  content: string
  createdAt: number
  updatedAt: number
}): UserMemory => ({
  id: r.id,
  scope: r.scope === 'session' ? 'session' : 'global',
  sessionId: r.sessionId ?? undefined,
  category: r.category,
  content: r.content,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})

export function addMemory(m: UserMemory): void {
  const database = getDb()
  database
    .prepare(
      `INSERT OR REPLACE INTO user_memories (id, scope, sessionId, category, content, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.id,
      m.scope,
      m.scope === 'session' ? (m.sessionId ?? null) : null,
      m.category,
      m.content,
      m.createdAt,
      m.updatedAt
    )
}

export interface MemoryQuery {
  /** When set, restrict to this scope. Omit to return both global and the given session's. */
  scope?: 'global' | 'session'
  /** The current conversation; its session-scoped memories are included. */
  sessionId?: string
  category?: string
  limit?: number
}

/** Build the WHERE clause + params shared by list and search. The default (no scope) returns
 * all global memories plus the current session's session-scoped memories. */
function buildMemoryFilter(opts: MemoryQuery): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (opts.scope === 'global') {
    clauses.push(`scope = 'global'`)
  } else if (opts.scope === 'session') {
    clauses.push(`(scope = 'session' AND sessionId = ?)`)
    params.push(opts.sessionId ?? '')
  } else {
    // Both layers: every global memory, plus this session's session memories.
    if (opts.sessionId) {
      clauses.push(`(scope = 'global' OR (scope = 'session' AND sessionId = ?))`)
      params.push(opts.sessionId)
    } else {
      clauses.push(`scope = 'global'`)
    }
  }

  if (opts.category) {
    clauses.push(`category = ?`)
    params.push(opts.category)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listMemories(opts: MemoryQuery = {}): UserMemory[] {
  const database = getDb()
  const { where, params } = buildMemoryFilter(opts)
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))
  const rows = database
    .prepare(`SELECT * FROM user_memories ${where} ORDER BY updatedAt DESC LIMIT ?`)
    .all(...params, limit) as Parameters<typeof rowToUserMemory>[0][]
  return rows.map(rowToUserMemory)
}

export function searchMemories(query: string, opts: MemoryQuery = {}): UserMemory[] {
  const q = query.trim()
  if (!q) return listMemories(opts)
  const database = getDb()
  const { where, params } = buildMemoryFilter(opts)
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))
  const likeClause = where ? `${where} AND content LIKE ?` : `WHERE content LIKE ?`
  const rows = database
    .prepare(`SELECT * FROM user_memories ${likeClause} ORDER BY updatedAt DESC LIMIT ?`)
    .all(...params, `%${q}%`, limit) as Parameters<typeof rowToUserMemory>[0][]
  return rows.map(rowToUserMemory)
}

export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM user_memories WHERE id = ?').run(id)
}

/** Cascade-delete a conversation's session-scoped memories. Global memories are never touched. */
export function deleteSessionMemories(sessionId: string): number {
  const info = getDb()
    .prepare(`DELETE FROM user_memories WHERE scope = 'session' AND sessionId = ?`)
    .run(sessionId)
  return info.changes
}

// ── Resource Cache CRUD helpers ──────────────────────────────────────────

export function loadResourceCache(
  resourceId: string
): {
  id: string
  kind: string
  source: string
  title: string | null
  fingerprint: string | null
  totalChars: number | null
  fetchedRanges: string
  nextOffset: number | null
  status: string
  summary: string | null
  createdAt: number
  updatedAt: number
  chunks: Array<{
    id: string
    offset: number | null
    endOffset: number | null
    page: number | null
    section: string | null
    text: string | null
    summary: string | null
    createdAt: number
  }>
} | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM resource_cache WHERE id = ?').get(resourceId) as {
    id: string
    kind: string
    source: string
    title: string | null
    fingerprint: string | null
    totalChars: number | null
    fetchedRanges: string
    nextOffset: number | null
    status: string
    summary: string | null
    createdAt: number
    updatedAt: number
  } | null

  if (!row) return null

  const chunks = database
    .prepare('SELECT * FROM resource_chunks WHERE resourceId = ? ORDER BY offset ASC')
    .all(resourceId) as Array<{
    id: string
    offset: number | null
    endOffset: number | null
    page: number | null
    section: string | null
    text: string | null
    summary: string | null
    createdAt: number
  }>

  return { ...row, chunks }
}

export function upsertResourceCache(
  resourceId: string,
  kind: string,
  source: string,
  title: string | undefined,
  totalChars: number | undefined,
  fetchedRanges: string,
  nextOffset: number | undefined,
  status: string,
  summary: string | undefined,
  now: number
): void {
  const database = getDb()
  const existing = database.prepare('SELECT id FROM resource_cache WHERE id = ?').get(resourceId)

  if (existing) {
    database
      .prepare(
        `UPDATE resource_cache SET
         kind = ?, source = ?, title = ?, totalChars = ?, fetchedRanges = ?,
         nextOffset = ?, status = ?, summary = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        kind,
        source,
        title || null,
        totalChars ?? null,
        fetchedRanges,
        nextOffset ?? null,
        status,
        summary || null,
        now,
        resourceId
      )
  } else {
    database
      .prepare(
        `INSERT INTO resource_cache
         (id, kind, source, title, fingerprint, totalChars, fetchedRanges, nextOffset, status, summary, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        resourceId,
        kind,
        source,
        title || null,
        null,
        totalChars ?? null,
        fetchedRanges,
        nextOffset ?? null,
        status,
        summary || null,
        now,
        now
      )
  }
}

export function upsertResourceChunk(
  resourceId: string,
  chunk: SessionResourceChunk
): void {
  const database = getDb()
  database
    .prepare(
      `INSERT OR REPLACE INTO resource_chunks
       (id, resourceId, offset, endOffset, page, section, text, summary, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      chunk.id,
      resourceId,
      chunk.offset ?? null,
      chunk.endOffset ?? null,
      chunk.page ?? null,
      chunk.section || null,
      chunk.text || null,
      chunk.summary || null,
      chunk.createdAt
    )
}

export function deleteResourceFromDb(resourceId: string): void {
  const database = getDb()
  database.prepare('DELETE FROM resource_cache WHERE id = ?').run(resourceId)
}

export function getResourceChunkText(resourceId: string, offset: number): string | null {
  const database = getDb()

  // Exact offset match first
  let row = database
    .prepare('SELECT text FROM resource_chunks WHERE resourceId = ? AND offset = ?')
    .get(resourceId, offset) as { text: string | null } | undefined

  if (row && row.text) return row.text

  // Range overlap fallback
  row = database
    .prepare(
      `SELECT text FROM resource_chunks
       WHERE resourceId = ? AND offset <= ? AND endOffset > ?
       ORDER BY offset ASC LIMIT 1`
    )
    .get(resourceId, offset, offset) as { text: string | null } | undefined

  return row?.text || null
}

export function pruneResourceChunks(resourceId: string, maxTextChars: number): void {
  const database = getDb()
  const chunks = database
    .prepare('SELECT id, text FROM resource_chunks WHERE resourceId = ? ORDER BY createdAt ASC')
    .all(resourceId) as Array<{ id: string; text: string | null }>

  let totalChars = chunks.reduce((sum, c) => sum + (c.text?.length || 0), 0)
  for (const chunk of chunks) {
    if (totalChars <= maxTextChars) break
    database.prepare('DELETE FROM resource_chunks WHERE resourceId = ? AND id = ?').run(resourceId, chunk.id)
    totalChars -= chunk.text?.length || 0
  }
}

export function getResourceChunksMetadata(
  resourceId: string
): Array<{ id: string; offset: number | null; endOffset: number | null; createdAt: number }> {
  const database = getDb()
  return database
    .prepare('SELECT id, offset, endOffset, createdAt FROM resource_chunks WHERE resourceId = ?')
    .all(resourceId) as Array<{ id: string; offset: number | null; endOffset: number | null; createdAt: number }>
}

export function isDatabaseInitialized(): boolean {
  return db !== null
}

// ── Resource Links (for click_link) ──────────────────────────────────────

export function saveResourceLinks(
  resourceId: string,
  links: Array<{ id: number; text: string; href: string }>
): void {
  const database = getDb()
  database.prepare('DELETE FROM resource_links WHERE resourceId = ?').run(resourceId)
  if (links.length === 0) return
  const insert = database.prepare(
    'INSERT OR REPLACE INTO resource_links (resourceId, linkId, text, href) VALUES (?, ?, ?, ?)'
  )
  for (const link of links) {
    insert.run(resourceId, link.id, link.text, link.href)
  }
}

export function loadResourceLinks(
  resourceId: string
): Array<{ id: number; text: string; href: string }> {
  const database = getDb()
  const rows = database
    .prepare('SELECT linkId, text, href FROM resource_links WHERE resourceId = ? ORDER BY linkId ASC')
    .all(resourceId) as Array<{ linkId: number; text: string; href: string }>
  return rows.map((r) => ({ id: r.linkId, text: r.text, href: r.href }))
}

export function getResourceLink(
  resourceId: string,
  linkId: number
): { id: number; text: string; href: string } | null {
  const database = getDb()
  const row = database
    .prepare('SELECT linkId, text, href FROM resource_links WHERE resourceId = ? AND linkId = ?')
    .get(resourceId, linkId) as { linkId: number; text: string; href: string } | undefined
  return row ? { id: row.linkId, text: row.text, href: row.href } : null
}

// Concatenate all cached chunk texts in offset order — used by find_in_page.
export function getResourceFullText(resourceId: string): string {
  const database = getDb()
  const rows = database
    .prepare('SELECT text FROM resource_chunks WHERE resourceId = ? ORDER BY offset ASC')
    .all(resourceId) as Array<{ text: string | null }>
  return rows.map((r) => r.text || '').join('')
}
