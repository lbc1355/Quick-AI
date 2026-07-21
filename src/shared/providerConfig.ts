import type {
  ApiProvider,
  ModelInfo,
  ModelRuntimeConfig,
  ProviderAccount,
  ProviderDefinition,
  ResolvedProviderConnection
} from './types'
import { getProviderModelRuntimeConfig, normalizeProviderModelCatalog } from './modelCatalog'
import { getActiveProviderApiKey, normalizeProviderApiKeys } from './providerKeyHelper'
import { getProviderRegistration, getRegisteredProviderAuthType } from './providerRegistry'
import {
  apiFormatToTransportId,
  getProviderRuntimeProfile,
  transportIdToApiFormat
} from './providerProfiles'

export interface ResolvedProviderSelection {
  definition: ProviderDefinition
  account: ProviderAccount
  connection: ResolvedProviderConnection
  model: ModelRuntimeConfig
}

export interface SplitProviderConfigurations {
  definitions: ProviderDefinition[]
  accounts: ProviderAccount[]
}

/** Split the legacy combined ApiProvider record into static provider/model metadata. */
export function getProviderDefinition(provider: ApiProvider): ProviderDefinition {
  const normalized = normalizeProviderModelCatalog(provider)
  const runtime = getProviderRuntimeProfile(normalized.type)
  const transportId =
    normalized.transportId ||
    (normalized.apiFormat ? apiFormatToTransportId(normalized.apiFormat) : runtime.transportId)
  return {
    id: normalized.id,
    name: normalized.name,
    type: normalized.type,
    endpointType: normalized.endpointType!,
    defaultModelId: normalized.model,
    models: normalized.models || {},
    modelContextWindows: { ...(normalized.modelContextWindows || {}) },
    transportId,
    apiFormat: normalized.apiFormat || transportIdToApiFormat(transportId),
    features: { ...runtime.features, ...(normalized.features || {}) },
    compatibility: { ...runtime.compatibility, ...(normalized.compatibility || {}) },
    promptProfile: normalized.promptProfile || runtime.promptProfile
  }
}

/** Split mutable URL/authentication data out of the legacy combined ApiProvider record. */
export function getProviderAccount(provider: ApiProvider): ProviderAccount {
  const normalized = normalizeProviderApiKeys(provider)
  const accountDefaults = getProviderRegistration(provider.type)?.accountDefaults
  return {
    id: provider.id,
    providerId: provider.id,
    name: provider.name,
    apiUrl: provider.apiUrl,
    apiKeys: normalized.apiKeys || [],
    activeApiKeyId: normalized.activeApiKeyId,
    authType: provider.authType || getRegisteredProviderAuthType(provider.type),
    authHeader: provider.authHeader || accountDefaults?.authHeader,
    headers: { ...(accountDefaults?.headers || {}), ...(provider.headers || {}) }
  }
}

/** Rebuild the legacy renderer-facing provider view from canonical definition/account records. */
export function composeProviderConfiguration(
  definition: ProviderDefinition,
  account: ProviderAccount
): ApiProvider {
  const modelEntries = Object.entries(definition.models || {}).map(([id, model]) => [
    id,
    { ...model, providerId: account.id }
  ])
  const models = Object.fromEntries(modelEntries) as Record<string, ModelInfo>
  const modelsList = Object.keys(models).filter((id) => models[id]?.enabled !== false)
  const defaultModelId =
    (definition.defaultModelId && modelsList.includes(definition.defaultModelId)
      ? definition.defaultModelId
      : undefined) ||
    modelsList[0] ||
    ''
  const activeKey = account.apiKeys.find((key) => key.id === account.activeApiKeyId)?.value || ''

  return normalizeProviderApiKeys(
    normalizeProviderModelCatalog({
      id: account.id,
      name: account.name || definition.name,
      type: definition.type,
      apiKey: activeKey,
      apiKeys: account.apiKeys.map((key) => ({ ...key })),
      activeApiKeyId: account.activeApiKeyId,
      apiUrl: account.apiUrl,
      authType: account.authType,
      authHeader: account.authHeader,
      headers: { ...(account.headers || {}) },
      model: defaultModelId,
      modelsList,
      modelContextWindows: { ...(definition.modelContextWindows || {}) },
      endpointType: definition.endpointType,
      models,
      transportId: definition.transportId,
      apiFormat: definition.apiFormat,
      features: definition.features,
      compatibility: definition.compatibility,
      promptProfile: definition.promptProfile
    })
  )
}

/** Convert the compatibility view into records suitable for split persistence. */
export function splitProviderConfigurations(providers: ApiProvider[]): SplitProviderConfigurations {
  return {
    definitions: providers.map(getProviderDefinition),
    accounts: providers.map(getProviderAccount)
  }
}

export function composeProviderConfigurations(
  definitions: ProviderDefinition[],
  accounts: ProviderAccount[]
): ApiProvider[] {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  return accounts
    .map((account) => {
      const definition = definitionsById.get(account.providerId)
      return definition ? composeProviderConfiguration(definition, account) : undefined
    })
    .filter((provider): provider is ApiProvider => Boolean(provider))
}

export function resolveProviderConnection(account: ProviderAccount): ResolvedProviderConnection {
  const activeKey = account.apiKeys.find((key) => key.id === account.activeApiKeyId)?.value || ''
  const auth =
    account.authType === 'none'
      ? ({ type: 'none' } as const)
      : account.authType === 'header'
        ? ({
            type: 'header',
            name: account.authHeader?.trim() || 'X-API-Key',
            value: activeKey
          } as const)
        : ({ type: 'bearer', token: activeKey } as const)

  return {
    accountId: account.id,
    providerId: account.providerId,
    baseUrl: account.apiUrl,
    auth,
    headers: { ...(account.headers || {}) }
  }
}

/** Resolve the complete provider/account/model selection once at the UI/runtime boundary. */
export function resolveProviderSelection(
  provider: ApiProvider | undefined,
  modelId: string
): ResolvedProviderSelection | undefined {
  if (!provider || !modelId) return undefined
  const normalized = normalizeProviderModelCatalog(provider)
  const model = getProviderModelRuntimeConfig(normalized, modelId)
  if (!model) return undefined
  const definition = getProviderDefinition(normalized)
  const account = getProviderAccount(normalized)
  return {
    definition,
    account,
    connection: resolveProviderConnection(account),
    model
  }
}

/** Compatibility helper for old code that still expects the selected token as a string. */
export function getProviderConnectionApiKey(connection: ResolvedProviderConnection): string {
  if (connection.auth.type === 'bearer') return connection.auth.token
  if (connection.auth.type === 'header') return connection.auth.value
  return ''
}

/** Assert legacy and split account resolution stay aligned during the migration period. */
export function hasLegacyConnectionParity(provider: ApiProvider): boolean {
  const account = getProviderAccount(provider)
  return (
    getProviderConnectionApiKey(resolveProviderConnection(account)) ===
    getActiveProviderApiKey(provider)
  )
}
