import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { StorageSchema } from '../../shared/types'
import { normalizeProviderModelCatalog } from '../../shared/modelCatalog'
import {
  normalizeProviderApiKeys,
  getActiveProviderApiKey
} from '../../shared/providerKeyHelper'

export function migrateFromJson(database: Database.Database, dataDir: string): void {
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
      if (settings.providerPresetVersion !== undefined) {
        insertSetting.run('providerPresetVersion', String(settings.providerPresetVersion))
      }

      if (settings.permissions) {
        insertSetting.run('permissions', JSON.stringify(settings.permissions))
      }

      // ── Providers ──
      if (settings.providers && settings.providers.length > 0) {
        const insertProvider = database.prepare(
          `INSERT OR REPLACE INTO providers
           (id, name, type, apiKey, apiUrl, model, modelsList, modelContextWindows, endpointType, models, apiKeys, activeApiKeyId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const p of settings.providers) {
          const normalized = normalizeProviderModelCatalog(p)
          const withKeys = normalizeProviderApiKeys(normalized)
          const activeKeyVal = getActiveProviderApiKey(withKeys)
          insertProvider.run(
            withKeys.id,
            withKeys.name,
            withKeys.type || 'custom',
            activeKeyVal,
            withKeys.apiUrl,
            withKeys.model,
            JSON.stringify(withKeys.modelsList || []),
            JSON.stringify(withKeys.modelContextWindows || {}),
            withKeys.endpointType || null,
            JSON.stringify(withKeys.models || {}),
            JSON.stringify(withKeys.apiKeys || []),
            withKeys.activeApiKeyId || null
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
        `INSERT OR REPLACE INTO messages (id, sessionId, role, content, reasoning_content, agentRunId, agentRunIds, agentEvents, tokenSpeed, cacheStats, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
