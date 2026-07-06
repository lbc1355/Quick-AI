import { ApiProvider, AppSettings, ProviderApiFormat } from '../../shared/types'
import { normalizeProviderModelCatalog } from '../../shared/modelCatalog'
import {
  normalizeProviderApiKeys,
  getActiveProviderApiKey
} from '../../shared/providerKeyHelper'
import { getDb } from './connection'

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
    apiKeys?: string
    activeApiKeyId?: string
    apiUrl: string
    model: string
    modelsList: string
    modelContextWindows: string
    endpointType: string | null
    models: string
    apiFormat: string | null
  }>

  let permissions: { [toolName: string]: 'allow' | 'ask' | 'deny' } = {}
  try {
    permissions = JSON.parse(kv['permissions'] || '{}')
  } catch {
    // ignore
  }

  let webSearch: AppSettings['webSearch']
  try {
    if (kv['webSearch']) webSearch = JSON.parse(kv['webSearch'])
  } catch {
    // ignore malformed config; fall back to default (auto/html)
  }

  return {
    providers: providers.map((p) => {
      let parsedApiKeys = []
      try {
        parsedApiKeys = JSON.parse(p.apiKeys || '[]')
      } catch {
        // ignore
      }

      const normalizedCatalog = normalizeProviderModelCatalog({
        id: p.id,
        name: p.name,
        type: p.type as ApiProvider['type'],
        apiKey: p.apiKey,
        apiKeys: parsedApiKeys,
        activeApiKeyId: p.activeApiKeyId || undefined,
        apiUrl: p.apiUrl,
        model: p.model,
        modelsList: JSON.parse(p.modelsList || '[]'),
        modelContextWindows: JSON.parse(p.modelContextWindows || '{}'),
        endpointType: (p.endpointType || undefined) as ApiProvider['endpointType'],
        models: JSON.parse(p.models || '{}'),
        apiFormat: (p.apiFormat || undefined) as ProviderApiFormat
      })

      return normalizeProviderApiKeys(normalizedCatalog)
    }),
    activeProviderId: kv['activeProviderId'] || '',
    systemPrompt: kv['systemPrompt'] || '',
    autoHideOnBlur: kv['autoHideOnBlur'] !== 'false',
    contextRetentionMode:
      kv['contextRetentionMode'] === 'cache-priority' ? 'cache-priority' : 'default',
    theme: (kv['theme'] as 'dark' | 'light') || 'dark',
    permissions,
    webSearch,
    providerPresetVersion: Number(kv['providerPresetVersion'] || 0)
  }
}

export function saveSettings(settings: AppSettings): void {
  const database = getDb()
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const deleteProviders = database.prepare('DELETE FROM providers')
  const insert = database.prepare(
    'INSERT OR REPLACE INTO providers (id, name, type, apiKey, apiUrl, model, modelsList, modelContextWindows, endpointType, models, apiKeys, activeApiKeyId, apiFormat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  // Wrap the whole save in a single transaction: turns N independent fsync-per-statement
  // writes into one, and makes the delete-then-reinsert atomic (a mid-write crash can no
  // longer leave the providers table empty).
  const persist = database.transaction((s: AppSettings) => {
    upsert.run('systemPrompt', s.systemPrompt)
    upsert.run('autoHideOnBlur', String(s.autoHideOnBlur))
    upsert.run('contextRetentionMode', s.contextRetentionMode || 'default')
    upsert.run('theme', s.theme || 'dark')
    upsert.run('activeProviderId', s.activeProviderId)
    upsert.run('permissions', JSON.stringify(s.permissions || {}))
    upsert.run('webSearch', JSON.stringify(s.webSearch || {}))
    upsert.run('providerPresetVersion', String(s.providerPresetVersion || 0))

    // Providers: delete all then re-insert
    deleteProviders.run()
    for (const p of s.providers) {
      const normalized = normalizeProviderModelCatalog(p)
      const withKeys = normalizeProviderApiKeys(normalized)
      const activeKeyVal = getActiveProviderApiKey(withKeys)

      insert.run(
        withKeys.id,
        withKeys.name,
        withKeys.type,
        activeKeyVal,
        withKeys.apiUrl,
        withKeys.model,
        JSON.stringify(withKeys.modelsList || []),
        JSON.stringify(withKeys.modelContextWindows || {}),
        withKeys.endpointType || null,
        JSON.stringify(withKeys.models || {}),
        JSON.stringify(withKeys.apiKeys || []),
        withKeys.activeApiKeyId || null,
        withKeys.apiFormat || null
      )
    }
  })
  persist(settings)
}
