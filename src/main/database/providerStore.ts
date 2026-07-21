import type Database from 'better-sqlite3'
import type {
  ApiKeyItem,
  ApiProvider,
  ModelCompatibilityProfile,
  ModelFeatureSupport,
  ModelInfo,
  ModelPromptProfile,
  ModelTransportId,
  ProviderAccount,
  ProviderApiFormat,
  ProviderAuthType,
  ProviderDefinition,
  ProviderEndpointType,
  ProviderType
} from '../../shared/types'
import { normalizeProviderModelCatalog } from '../../shared/modelCatalog'
import { normalizeProviderApiKeys } from '../../shared/providerKeyHelper'
import {
  composeProviderConfigurations,
  splitProviderConfigurations
} from '../../shared/providerConfig'
import { getRegisteredProviderAuthType } from '../../shared/providerRegistry'

interface LegacyProviderRow {
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
  transportId: string | null
  promptProfile: string | null
  features: string | null
  compatibility: string | null
  authType: string | null
  authHeader: string | null
  headers: string | null
}

interface ProviderDefinitionRow {
  id: string
  name: string
  type: string
  endpointType: string
  defaultModelId: string | null
  models: string
  modelContextWindows: string
  transportId: string | null
  apiFormat: string | null
  promptProfile: string | null
  features: string | null
  compatibility: string | null
}

interface ProviderAccountRow {
  id: string
  providerId: string
  name: string
  apiUrl: string
  apiKeys: string
  activeApiKeyId: string | null
  authType: string
  authHeader: string | null
  headers: string | null
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

const parseAuthType = (value: string | null | undefined, type: ProviderType): ProviderAuthType =>
  value === 'header' || value === 'none' || value === 'bearer'
    ? value
    : getRegisteredProviderAuthType(type)

function loadCanonicalProviders(database: Database.Database): ApiProvider[] {
  const definitionRows = database
    .prepare('SELECT * FROM provider_definitions ORDER BY rowid')
    .all() as ProviderDefinitionRow[]
  const accountRows = database
    .prepare('SELECT * FROM provider_accounts ORDER BY rowid')
    .all() as ProviderAccountRow[]

  const definitions: ProviderDefinition[] = definitionRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as ProviderType,
    endpointType: row.endpointType as ProviderEndpointType,
    defaultModelId: row.defaultModelId || undefined,
    models: parseJson<Record<string, ModelInfo>>(row.models, {}),
    modelContextWindows: parseJson<Record<string, number>>(row.modelContextWindows, {}),
    transportId: (row.transportId || undefined) as ModelTransportId | undefined,
    apiFormat: (row.apiFormat || undefined) as ProviderApiFormat | undefined,
    promptProfile: (row.promptProfile || undefined) as ModelPromptProfile | undefined,
    features: parseJson<ModelFeatureSupport | undefined>(row.features, undefined),
    compatibility: parseJson<ModelCompatibilityProfile | undefined>(row.compatibility, undefined)
  }))
  const definitionTypes = new Map(definitions.map((definition) => [definition.id, definition.type]))
  const accounts: ProviderAccount[] = accountRows
    .filter((row) => definitionTypes.has(row.providerId))
    .map((row) => ({
      id: row.id,
      providerId: row.providerId,
      name: row.name,
      apiUrl: row.apiUrl,
      apiKeys: parseJson<ApiKeyItem[]>(row.apiKeys, []),
      activeApiKeyId: row.activeApiKeyId || undefined,
      authType: parseAuthType(row.authType, definitionTypes.get(row.providerId)!),
      authHeader: row.authHeader || undefined,
      headers: parseJson<Record<string, string>>(row.headers, {})
    }))

  return composeProviderConfigurations(definitions, accounts)
}

function loadLegacyProviders(database: Database.Database): ApiProvider[] {
  const rows = database
    .prepare('SELECT * FROM providers ORDER BY rowid')
    .all() as LegacyProviderRow[]
  return rows.map((row) => {
    const type = row.type as ProviderType
    const normalizedCatalog = normalizeProviderModelCatalog({
      id: row.id,
      name: row.name,
      type,
      apiKey: row.apiKey,
      apiKeys: parseJson<ApiKeyItem[]>(row.apiKeys, []),
      activeApiKeyId: row.activeApiKeyId || undefined,
      apiUrl: row.apiUrl,
      model: row.model,
      modelsList: parseJson<string[]>(row.modelsList, []),
      modelContextWindows: parseJson<Record<string, number>>(row.modelContextWindows, {}),
      endpointType: (row.endpointType || undefined) as ApiProvider['endpointType'],
      models: parseJson<Record<string, ModelInfo>>(row.models, {}),
      transportId: (row.transportId || undefined) as ModelTransportId,
      apiFormat: (row.apiFormat || undefined) as ProviderApiFormat,
      promptProfile: (row.promptProfile || undefined) as ModelPromptProfile,
      features: parseJson<ModelFeatureSupport>(row.features, {}),
      compatibility: parseJson<ModelCompatibilityProfile>(row.compatibility, {}),
      authType: parseAuthType(row.authType, type),
      authHeader: row.authHeader || undefined,
      headers: parseJson<Record<string, string>>(row.headers, {})
    })

    return normalizeProviderApiKeys(normalizedCatalog)
  })
}

/** Replace canonical provider rows. The caller owns the surrounding transaction. */
export function saveProviderConfigurations(
  database: Database.Database,
  providers: ApiProvider[]
): void {
  const deleteAccounts = database.prepare('DELETE FROM provider_accounts')
  const deleteDefinitions = database.prepare('DELETE FROM provider_definitions')
  const deleteLegacyProviders = database.prepare('DELETE FROM providers')
  const insertDefinition = database.prepare(
    `INSERT OR REPLACE INTO provider_definitions
      (id, name, type, endpointType, defaultModelId, models, modelContextWindows, transportId, apiFormat, promptProfile, features, compatibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertAccount = database.prepare(
    `INSERT OR REPLACE INTO provider_accounts
      (id, providerId, name, apiUrl, apiKeys, activeApiKeyId, authType, authHeader, headers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const { definitions, accounts } = splitProviderConfigurations(providers)

  deleteAccounts.run()
  deleteDefinitions.run()
  for (const definition of definitions) {
    insertDefinition.run(
      definition.id,
      definition.name,
      definition.type,
      definition.endpointType,
      definition.defaultModelId || null,
      JSON.stringify(definition.models || {}),
      JSON.stringify(definition.modelContextWindows || {}),
      definition.transportId || null,
      definition.apiFormat || null,
      definition.promptProfile || null,
      JSON.stringify(definition.features || {}),
      JSON.stringify(definition.compatibility || {})
    )
  }
  for (const account of accounts) {
    insertAccount.run(
      account.id,
      account.providerId,
      account.name,
      account.apiUrl,
      JSON.stringify(account.apiKeys || []),
      account.activeApiKeyId || null,
      account.authType,
      account.authHeader || null,
      JSON.stringify(account.headers || {})
    )
  }
  deleteLegacyProviders.run()
}

/** Load canonical rows, migrating the legacy combined table atomically on first read. */
export function loadProviderConfigurations(database: Database.Database): ApiProvider[] {
  const canonical = loadCanonicalProviders(database)
  if (canonical.length > 0) return canonical

  const legacy = loadLegacyProviders(database)
  if (legacy.length > 0) {
    database.transaction(() => saveProviderConfigurations(database, legacy))()
  }
  return legacy
}
