import type Database from 'better-sqlite3'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiProvider, AppSettings } from '../../shared/types'
import { createSchema } from './schema'
import { loadProviderConfigurations, saveProviderModelDiscoveryCache } from './providerStore'
import { loadSettingsFromDatabase, saveSettingsToDatabase } from './settingsStore'

const provider = (): ApiProvider => ({
  id: 'provider-work',
  name: 'Work GLM',
  type: 'glm',
  apiKey: 'legacy-secret',
  apiKeys: [
    { id: 'key-1', name: 'Primary', value: 'secret-primary' },
    { id: 'key-2', name: 'Backup', value: 'secret-backup' }
  ],
  activeApiKeyId: 'key-2',
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
  authType: 'header',
  authHeader: 'X-API-Key',
  headers: { 'X-Tenant': 'quick-ai' },
  model: 'glm-4.7',
  modelsList: ['glm-4.7'],
  modelContextWindows: { 'glm-4.7': 96000 },
  modelDiscovery: {
    sourceUrl: 'https://open.bigmodel.cn/api/paas/v4/models',
    models: [{ id: 'glm-4.7', contextWindowTokens: 96000 }],
    checkedAt: 200,
    refreshedAt: 100,
    error: 'temporary outage'
  }
})

describe('provider persistence', () => {
  let rawDatabase: DatabaseSync
  let database: Database.Database

  beforeEach(() => {
    rawDatabase = new DatabaseSync(':memory:')
    rawDatabase.exec('PRAGMA foreign_keys = ON')
    database = {
      exec: (sql: string) => rawDatabase.exec(sql),
      prepare: (sql: string) => rawDatabase.prepare(sql),
      transaction:
        <Args extends unknown[], Result>(operation: (...args: Args) => Result) =>
        (...args: Args): Result => {
          rawDatabase.exec('BEGIN')
          try {
            const result = operation(...args)
            rawDatabase.exec('COMMIT')
            return result
          } catch (error) {
            rawDatabase.exec('ROLLBACK')
            throw error
          }
        }
    } as unknown as Database.Database
    createSchema(database)
  })

  afterEach(() => {
    rawDatabase.close()
  })

  it('stores definitions and credential-bearing accounts in separate tables', () => {
    const settings: AppSettings = {
      providers: [provider()],
      activeProviderId: 'provider-work',
      systemPrompt: 'system',
      autoHideOnBlur: true,
      providerPresetVersion: 3,
      reasoningDefaults: { [JSON.stringify(['provider-work', 'glm-4.7'])]: 'high' }
    }

    saveSettingsToDatabase(database, settings)

    const definition = database
      .prepare('SELECT * FROM provider_definitions WHERE id = ?')
      .get('provider-work') as Record<string, unknown>
    const account = database
      .prepare('SELECT * FROM provider_accounts WHERE id = ?')
      .get('provider-work') as Record<string, unknown>
    const legacyCount = database.prepare('SELECT COUNT(*) AS count FROM providers').get() as {
      count: number
    }

    expect(JSON.stringify(definition)).not.toContain('secret-backup')
    expect(String(account.apiKeys)).toContain('secret-backup')
    expect(String(account.modelDiscovery)).toContain('glm-4.7')
    expect(legacyCount.count).toBe(0)

    const loaded = loadSettingsFromDatabase(database)
    expect(loaded.activeProviderId).toBe('provider-work')
    expect(loaded.reasoningDefaults).toEqual({
      [JSON.stringify(['provider-work', 'glm-4.7'])]: 'high'
    })
    expect(loaded.providers[0]).toMatchObject({
      id: 'provider-work',
      model: 'glm-4.7',
      apiKey: 'secret-backup',
      activeApiKeyId: 'key-2',
      authType: 'header',
      authHeader: 'X-API-Key',
      headers: { 'X-Tenant': 'quick-ai' }
    })
    expect(loaded.providers[0].modelContextWindows?.['glm-4.7']).toBe(96000)
    expect(loaded.providers[0].modelDiscovery).toEqual({
      sourceUrl: 'https://open.bigmodel.cn/api/paas/v4/models',
      models: [{ id: 'glm-4.7', contextWindowTokens: 96000 }],
      checkedAt: 200,
      refreshedAt: 100,
      error: 'temporary outage'
    })
  })

  it('migrates the legacy combined provider table on first read', () => {
    database
      .prepare(
        `INSERT INTO providers
          (id, name, type, apiKey, apiUrl, model, modelsList, modelContextWindows, models,
           apiKeys, activeApiKeyId, authType, authHeader, headers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'legacy-provider',
        'Legacy',
        'custom',
        'legacy-secret',
        'https://legacy.example/v1',
        'legacy-model',
        JSON.stringify(['legacy-model']),
        JSON.stringify({ 'legacy-model': 32000 }),
        JSON.stringify({}),
        JSON.stringify([{ id: 'legacy-key', name: 'Legacy', value: 'legacy-secret' }]),
        'legacy-key',
        'bearer',
        null,
        JSON.stringify({ 'X-Legacy': 'yes' })
      )

    const loaded = loadProviderConfigurations(database)

    expect(loaded[0]).toMatchObject({
      id: 'legacy-provider',
      model: 'legacy-model',
      apiKey: 'legacy-secret',
      headers: { 'X-Legacy': 'yes' }
    })
    expect(
      (
        database.prepare('SELECT COUNT(*) AS count FROM provider_definitions').get() as {
          count: number
        }
      ).count
    ).toBe(1)
    expect(
      (
        database.prepare('SELECT COUNT(*) AS count FROM provider_accounts').get() as {
          count: number
        }
      ).count
    ).toBe(1)
    expect(
      (database.prepare('SELECT COUNT(*) AS count FROM providers').get() as { count: number }).count
    ).toBe(0)
  })

  it('updates one account discovery cache without rewriting provider settings', () => {
    const settings: AppSettings = {
      providers: [provider()],
      activeProviderId: 'provider-work',
      systemPrompt: 'system',
      autoHideOnBlur: true
    }
    saveSettingsToDatabase(database, settings)

    const updated = saveProviderModelDiscoveryCache(database, 'provider-work', {
      sourceUrl: 'https://open.bigmodel.cn/api/paas/v4/models',
      models: [{ id: 'glm-new' }],
      checkedAt: 300,
      refreshedAt: 300
    })

    expect(updated).toBe(true)
    const loaded = loadSettingsFromDatabase(database)
    expect(loaded.systemPrompt).toBe('system')
    expect(loaded.providers[0].model).toBe('glm-4.7')
    expect(loaded.providers[0].modelDiscovery?.models).toEqual([{ id: 'glm-new' }])
    expect(
      saveProviderModelDiscoveryCache(database, 'missing', {
        sourceUrl: 'https://missing.test/models',
        models: []
      })
    ).toBe(false)

    saveSettingsToDatabase(database, settings)
    expect(loadSettingsFromDatabase(database).providers[0].modelDiscovery?.models).toEqual([
      { id: 'glm-new' }
    ])
  })
})
