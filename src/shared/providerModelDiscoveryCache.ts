import type {
  FetchedModelInfo,
  ModelCapability,
  ProviderModelDiscoveryCache,
  ProviderModelDiscoveryRequest
} from './types'

export const MODEL_DISCOVERY_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const MODEL_DISCOVERY_ERROR_RETRY_DELAY_MS = 5 * 60 * 1000

const normalizeSourceUrl = (sourceUrl: string): string => sourceUrl.trim()

const MODEL_CAPABILITIES = new Set<ModelCapability>(['text', 'vision', 'tools', 'reasoning'])

const optionalTimestamp = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export function normalizeProviderModelDiscoveryCache(
  value: unknown
): ProviderModelDiscoveryCache | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.sourceUrl !== 'string' || !raw.sourceUrl.trim() || !Array.isArray(raw.models)) {
    return undefined
  }
  const models = raw.models
    .filter((model): model is Record<string, unknown> =>
      Boolean(model && typeof model === 'object' && typeof model.id === 'string' && model.id.trim())
    )
    .map((model): FetchedModelInfo => {
      const displayName =
        typeof model.displayName === 'string' && model.displayName.trim()
          ? model.displayName.trim()
          : undefined
      const contextWindowTokens =
        typeof model.contextWindowTokens === 'number' &&
        Number.isFinite(model.contextWindowTokens) &&
        model.contextWindowTokens > 0
          ? model.contextWindowTokens
          : undefined
      const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.filter(
            (capability): capability is ModelCapability =>
              typeof capability === 'string' &&
              MODEL_CAPABILITIES.has(capability as ModelCapability)
          )
        : undefined
      return {
        id: String(model.id).trim(),
        ...(displayName ? { displayName } : {}),
        ...(contextWindowTokens ? { contextWindowTokens } : {}),
        ...(capabilities?.length ? { capabilities } : {})
      }
    })

  return {
    sourceUrl: normalizeSourceUrl(raw.sourceUrl),
    models,
    checkedAt: optionalTimestamp(raw.checkedAt),
    refreshedAt: optionalTimestamp(raw.refreshedAt),
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : undefined
  }
}

export function getCachedProviderModels(
  cache: ProviderModelDiscoveryCache | undefined,
  sourceUrl: string
): FetchedModelInfo[] {
  if (!cache || cache.sourceUrl !== normalizeSourceUrl(sourceUrl)) return []
  return cache.models.map((model) => ({
    ...model,
    ...(model.capabilities ? { capabilities: [...model.capabilities] } : {})
  }))
}

export function completeProviderModelDiscovery(
  sourceUrl: string,
  models: FetchedModelInfo[],
  checkedAt = Date.now()
): ProviderModelDiscoveryCache {
  return (
    normalizeProviderModelDiscoveryCache({
      sourceUrl: normalizeSourceUrl(sourceUrl),
      models,
      checkedAt,
      refreshedAt: checkedAt
    }) || {
      sourceUrl: normalizeSourceUrl(sourceUrl),
      models: [],
      checkedAt,
      refreshedAt: checkedAt
    }
  )
}

export function failProviderModelDiscovery(
  previous: ProviderModelDiscoveryCache | undefined,
  sourceUrl: string,
  error: unknown,
  checkedAt = Date.now()
): ProviderModelDiscoveryCache {
  const normalizedUrl = normalizeSourceUrl(sourceUrl)
  const normalizedPrevious = normalizeProviderModelDiscoveryCache(previous)
  const canReusePrevious = normalizedPrevious?.sourceUrl === normalizedUrl
  const message = error instanceof Error ? error.message : String(error || 'Unknown error')
  return {
    sourceUrl: normalizedUrl,
    models: canReusePrevious ? getCachedProviderModels(normalizedPrevious, normalizedUrl) : [],
    checkedAt,
    refreshedAt: canReusePrevious ? normalizedPrevious.refreshedAt : undefined,
    error: message
  }
}

export function shouldRefreshProviderModels(
  cache: ProviderModelDiscoveryCache | undefined,
  sourceUrl: string,
  now = Date.now(),
  maxAgeMs = MODEL_DISCOVERY_CACHE_MAX_AGE_MS,
  errorRetryDelayMs = MODEL_DISCOVERY_ERROR_RETRY_DELAY_MS
): boolean {
  const normalizedUrl = normalizeSourceUrl(sourceUrl)
  if (!normalizedUrl) return false
  if (!cache || cache.sourceUrl !== normalizedUrl) return true
  if (cache.error) {
    return !cache.checkedAt || now - cache.checkedAt >= errorRetryDelayMs
  }
  if (!cache.refreshedAt) return true
  return now - cache.refreshedAt >= maxAgeMs
}

export function canRefreshProviderModelsInBackground(
  request: ProviderModelDiscoveryRequest
): boolean {
  if (!request.fetchUrl.trim() || !request.providerConnection.baseUrl.trim()) return false
  const { auth } = request.providerConnection
  return (
    auth.type === 'none' ||
    (auth.type === 'bearer' ? auth.token.trim() : auth.value.trim()).length > 0
  )
}
