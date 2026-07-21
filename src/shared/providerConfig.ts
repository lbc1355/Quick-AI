import type {
  ApiProvider,
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
    models: normalized.models || {},
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
    id: `${provider.id}:default`,
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
