import type Database from 'better-sqlite3'
import type { AppSettings } from '../../shared/types'
import { getDb } from './connection'
import { loadProviderConfigurations, saveProviderConfigurations } from './providerStore'

const parseJson = <T>(value: string | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function loadSettingsFromDatabase(database: Database.Database): AppSettings {
  const kvRows = database.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const kv: Record<string, string> = {}
  for (const row of kvRows) kv[row.key] = row.value

  return {
    providers: loadProviderConfigurations(database),
    activeProviderId: kv['activeProviderId'] || '',
    systemPrompt: kv['systemPrompt'] || '',
    autoHideOnBlur: kv['autoHideOnBlur'] !== 'false',
    contextRetentionMode:
      kv['contextRetentionMode'] === 'cache-priority' ? 'cache-priority' : 'default',
    theme: (kv['theme'] as 'dark' | 'light') || 'dark',
    permissions: parseJson(kv['permissions'], {}),
    webSearch: parseJson(kv['webSearch'], undefined),
    providerPresetVersion: Number(kv['providerPresetVersion'] || 0),
    reasoningDefaults: parseJson(kv['reasoningDefaults'], undefined)
  }
}

export function loadSettings(): AppSettings {
  return loadSettingsFromDatabase(getDb())
}

export function saveSettingsToDatabase(database: Database.Database, settings: AppSettings): void {
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const persist = database.transaction((value: AppSettings) => {
    upsert.run('systemPrompt', value.systemPrompt)
    upsert.run('autoHideOnBlur', String(value.autoHideOnBlur))
    upsert.run('contextRetentionMode', value.contextRetentionMode || 'default')
    upsert.run('theme', value.theme || 'dark')
    upsert.run('activeProviderId', value.activeProviderId)
    upsert.run('permissions', JSON.stringify(value.permissions || {}))
    upsert.run('webSearch', JSON.stringify(value.webSearch || {}))
    upsert.run('providerPresetVersion', String(value.providerPresetVersion || 0))
    upsert.run('reasoningDefaults', JSON.stringify(value.reasoningDefaults || {}))
    saveProviderConfigurations(database, value.providers || [])
  })
  persist(settings)
}

export function saveSettings(settings: AppSettings): void {
  saveSettingsToDatabase(getDb(), settings)
}
