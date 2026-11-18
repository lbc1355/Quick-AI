import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { StorageSchema } from '../../shared/types'
import { saveProviderConfigurations } from './providerStore'

export function migrateFromJson(database: Database.Database, dataDir: string): void {
  const storePath = join(dataDir, 'quickai_store.json')
  const resourcesDir = join(dataDir, 'resources')

  // Only migrate if we have old data AND the database is empty
  const hasOldStore = existsSync(storePath)
  const hasOldResources = existsSync(resourcesDir)

  if (!hasOldStore && !hasOldResources) return

  // Store migration is done once settings rows exist. Resource migration is done once every
  // resource JSON has been consumed (renamed to .bak). The two are independent: a resource file
  // that failed to migrate stays behind and is retried on a later launch even after the store has
  // already migrated.
  const storeMigrated =
    (database.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number }).c > 0

  if (hasOldStore && !storeMigrated) {
    migrateStore(database, storePath)
  }

  if (hasOldResources) {
    // migrateResources owns the directory read and its error boundary. Calling it even when the
    // directory contains no JSON files is cheap and prevents an unreadable/replaced legacy path
    // from aborting database initialization.
    migrateResources(database, resourcesDir)
  }
}

function migrateStore(database: Database.Database, storePath: string): void {
  console.log('[database] Migrating quickai_store.json → SQLite...')
  const bakPath = storePath + '.bak'
  // The whole import runs as one transaction: any failure rolls back every row (including the
  // settings), so a crash mid-migration leaves the DB empty and the next launch retries instead
  // of skipping forever on a half-written settings row.
  const runMigration = database.transaction(() => {
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
      insertSetting.run('contextRetentionMode', settings.contextRetentionMode || 'default')
      insertSetting.run('theme', settings.theme || 'dark')
      insertSetting.run('activeProviderId', settings.activeProviderId || '')
      if (settings.providerPresetVersion !== undefined) {
        insertSetting.run('providerPresetVersion', String(settings.providerPresetVersion))
      }

      if (settings.permissions) {
        insertSetting.run('permissions', JSON.stringify(settings.permissions))
      }
      if (settings.webSearch) {
        insertSetting.run('webSearch', JSON.stringify(settings.webSearch))
      }

      // ── Providers ──
      if (settings.providers && settings.providers.length > 0) {
        database.transaction(() => saveProviderConfigurations(database, settings.providers))()
      }
    }

    // ── Sessions & Messages ──
    if (data.sessions && data.sessions.length > 0) {
      const insertSession = database.prepare(
        'INSERT OR REPLACE INTO sessions (id, title, lastActiveTime) VALUES (?, ?, ?)'
      )
      const insertMessage = database.prepare(
        `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, isSynthetic, isInternal, tokenSpeed, cacheStats, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertFile = database.prepare(
        'INSERT INTO message_files (messageId, name, content, type) VALUES (?, ?, ?, ?)'
      )

      for (const session of data.sessions) {
        insertSession.run(session.id, session.title, session.lastActiveTime || 0)

        if (session.messages && session.messages.length > 0) {
          // Old JSON stores no per-message timestamp; the messages array is in conversation order,
          // so derive monotonic timestamps from the array position. (UUID ids made the old
          // `parseInt(msg.id) || Date.now()` collapse every message onto one timestamp, destroying
          // the intra-session order that `ORDER BY createdAt` later relies on.)
          const baseCreatedAt = Date.now()
          session.messages.forEach((msg, index) => {
            const numericId = Number(msg.id)
            const createdAt =
              Number.isInteger(numericId) &&
              numericId > 0 &&
              String(msg.id).trim() === String(numericId)
                ? numericId
                : baseCreatedAt + index
            insertMessage.run(
              msg.id,
              session.id,
              msg.role,
              msg.content || '',
              msg.reasoning_content || null,
              msg.agentRunId || null,
              JSON.stringify(msg.agentRunIds || (msg.agentRunId ? [msg.agentRunId] : [])),
              msg.agentEvents ? JSON.stringify(msg.agentEvents) : null,
              msg.isSynthetic === true ? 1 : 0,
              msg.isInternal === true ? 1 : 0,
              msg.tokenSpeed || null,
              msg.cacheStats ? JSON.stringify(msg.cacheStats) : null,
              createdAt
            )
            if (msg.files && msg.files.length > 0) {
              for (const f of msg.files) {
                insertFile.run(msg.id, f.name, f.content, f.type)
              }
            }
          })
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
  })
  try {
    runMigration()
    // Only rename once the transaction committed, so a failed import leaves the source for retry.
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
      const bakPath = filePath + '.bak'
      // Each file imports atomically: a corrupt file is rolled back and left in place (so it can be
      // retried or audited) without blocking the remaining files.
      const runFileMigration = database.transaction(() => {
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
      })
      try {
        runFileMigration()
        // Only rename after the file's rows committed, so a failed import keeps the source.
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
