import Database from 'better-sqlite3'

export function createSchema(database: Database.Database): void {
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
      modelsList TEXT NOT NULL DEFAULT '[]',
      modelContextWindows TEXT NOT NULL DEFAULT '{}',
      endpointType TEXT,
      models TEXT NOT NULL DEFAULT '{}',
      activeApiKeyId TEXT,
      apiFormat TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      lastActiveTime INTEGER NOT NULL DEFAULT 0,
      contextEpoch  INTEGER NOT NULL DEFAULT 0,
      projectId      TEXT REFERENCES projects(id) ON DELETE SET NULL,
      branchOf       TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      path      TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
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
      tokenSpeed        REAL,
      cacheStats        TEXT,
      errorPayload      TEXT,
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

    CREATE TABLE IF NOT EXISTS session_prompt_inbox (
      id                 TEXT PRIMARY KEY,
      sessionId          TEXT NOT NULL,
      contextEpoch       INTEGER NOT NULL DEFAULT 0,
      mode               TEXT NOT NULL CHECK (mode IN ('steer', 'queue')),
      status             TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
      runMode            TEXT NOT NULL CHECK (runMode IN ('chat', 'agent')),
      sourceMessageId    TEXT NOT NULL,
      assistantMessageId TEXT,
      messages           TEXT NOT NULL,
      createdAt          INTEGER NOT NULL,
      updatedAt          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_prompt_inbox_open
      ON session_prompt_inbox(sessionId, status, createdAt, id);
  `)

  // Additive column migrations for databases created before a column existed. CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so older DBs are missing these and would
  // silently drop the data on save (e.g. branch/fork metadata vanishing after a restart).
  ensureColumn(database, 'sessions', 'branchOf', 'TEXT')
  ensureColumn(database, 'sessions', 'contextEpoch', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(database, 'sessions', 'projectId', 'TEXT REFERENCES projects(id) ON DELETE SET NULL')
  // Per-session content hash used by saveSessions() to skip rewriting unchanged sessions.
  ensureColumn(database, 'sessions', 'contentHash', 'TEXT')
  ensureColumn(database, 'messages', 'forkedFrom', 'TEXT')
  ensureColumn(database, 'messages', 'isBranchFork', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(database, 'messages', 'agentRunIds', "TEXT DEFAULT '[]'")
  ensureColumn(database, 'messages', 'tokenSpeed', 'REAL')
  ensureColumn(database, 'messages', 'cacheStats', 'TEXT')
  ensureColumn(database, 'messages', 'errorPayload', 'TEXT')
  ensureColumn(database, 'providers', 'modelContextWindows', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn(database, 'providers', 'endpointType', 'TEXT')
  ensureColumn(database, 'providers', 'models', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn(database, 'providers', 'apiKeys', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn(database, 'providers', 'activeApiKeyId', 'TEXT')
  ensureColumn(database, 'providers', 'apiFormat', 'TEXT')
  ensureColumn(database, 'skills', 'entryPath', 'TEXT')
  ensureColumn(database, 'skills', 'packageRoot', 'TEXT')
  ensureColumn(database, 'skills', 'packageFiles', "TEXT DEFAULT '[]'")
  ensureColumn(database, 'session_prompt_inbox', 'contextEpoch', 'INTEGER NOT NULL DEFAULT 0')
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
