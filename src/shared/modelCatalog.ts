import { ApiProvider, ModelInfo, ModelRuntimeConfig, ProviderEndpointType } from './types'
import {
  ContextWindowInfo,
  getContextWindowInfo,
  normalizeContextWindowTokens
} from './modelContext'

export function getProviderEndpointType(
  provider: Pick<ApiProvider, 'type' | 'endpointType'>
): ProviderEndpointType {
  if (provider.endpointType) return provider.endpointType
  if (provider.type === 'ollama') return 'ollama-openai'
  if (provider.type === 'custom') return 'custom'
  return 'openai-compatible'
}

export function createModelInfo(
  provider: Pick<ApiProvider, 'id' | 'type' | 'endpointType' | 'apiFormat'>,
  modelId: string,
  contextTokens?: number,
  previous?: Partial<ModelInfo>
): ModelInfo {
  const normalizedContext =
    normalizeContextWindowTokens(contextTokens) ??
    normalizeContextWindowTokens(previous?.limit?.context) ??
    getContextWindowInfo(modelId).tokens

  return {
    id: previous?.id || modelId,
    apiId: previous?.apiId || modelId,
    providerId: provider.id,
    displayName: previous?.displayName,
    endpointType: previous?.endpointType || getProviderEndpointType(provider),
    capabilities: previous?.capabilities,
    limit: {
      context: normalizedContext,
      ...(previous?.limit?.output ? { output: previous.limit.output } : {})
    },
    enabled: previous?.enabled ?? true,
    apiFormat: previous?.apiFormat
  }
}

export function normalizeProviderModelCatalog(provider: ApiProvider): ApiProvider {
  const modelIds = Array.from(
    new Set(
      (provider.modelsList?.length
        ? provider.modelsList
        : [...Object.keys(provider.models || {}), ...(provider.model ? [provider.model] : [])]
      ).filter(Boolean)
    )
  )
  const models: Record<string, ModelInfo> = {}

  for (const modelId of modelIds) {
    const previous = provider.models?.[modelId]
    models[modelId] = createModelInfo(
      provider,
      modelId,
      provider.modelContextWindows?.[modelId],
      previous
    )
  }

  const enabledModelIds = modelIds.filter((id) => models[id]?.enabled !== false)

  return {
    ...provider,
    endpointType: provider.endpointType || getProviderEndpointType(provider),
    model: provider.model || enabledModelIds[0] || modelIds[0] || '',
    modelsList: enabledModelIds,
    modelContextWindows: Object.fromEntries(
      Object.entries(provider.modelContextWindows || {})
        .filter(
          ([id, context]) => enabledModelIds.includes(id) && normalizeContextWindowTokens(context)
        )
        .map(([id, context]) => [id, normalizeContextWindowTokens(context) as number])
    ),
    models
  }
}

export function normalizeProvidersModelCatalog(providers: ApiProvider[]): ApiProvider[] {
  return providers.map(normalizeProviderModelCatalog)
}

export function getProviderModels(provider: ApiProvider): ModelInfo[] {
  const normalized = provider.models ? provider : normalizeProviderModelCatalog(provider)
  const models = normalized.models || {}
  const ordered = (normalized.modelsList || [])
    .map((id) => models[id])
    .filter((model): model is ModelInfo => Boolean(model && model.enabled !== false))

  const orderedIds = new Set(ordered.map((model) => model.id))
  const extras = Object.values(models).filter(
    (model) => model.enabled !== false && !orderedIds.has(model.id)
  )
  return [...ordered, ...extras]
}

export function getProviderModelInfo(
  provider: ApiProvider | undefined,
  modelId: string
): ModelInfo | undefined {
  if (!provider || !modelId) return undefined
  const normalized = provider.models ? provider : normalizeProviderModelCatalog(provider)
  const direct = normalized.models?.[modelId]
  if (direct) return direct
  return getProviderModels(normalized).find(
    (model) => model.id === modelId || model.apiId === modelId || model.displayName === modelId
  )
}

export function getProviderModelRuntimeConfig(
  provider: ApiProvider | undefined,
  modelId: string
): ModelRuntimeConfig | undefined {
  if (!provider || !modelId) return undefined

  const normalized = provider.models ? provider : normalizeProviderModelCatalog(provider)
  const modelInfo =
    getProviderModelInfo(normalized, modelId) ||
    createModelInfo(normalized, modelId, normalized.modelContextWindows?.[modelId])
  const contextWindow =
    normalizeContextWindowTokens(normalized.modelContextWindows?.[modelInfo.id]) ??
    normalizeContextWindowTokens(modelInfo.limit.context) ??
    getContextWindowInfo(modelInfo.id).tokens

  return {
    providerId: normalized.id,
    providerType: normalized.type,
    endpointType:
      modelInfo.endpointType || normalized.endpointType || getProviderEndpointType(normalized),
    apiFormat: modelInfo.apiFormat ?? normalized.apiFormat ?? 'chat-completions',
    modelId: modelInfo.id,
    apiModel: modelInfo.apiId || modelInfo.id,
    displayName: modelInfo.displayName,
    capabilities: modelInfo.capabilities,
    contextWindowTokens: contextWindow
  }
}

export function getProviderModelContextWindowInfo(
  provider: ApiProvider | undefined,
  modelId: string
): ContextWindowInfo {
  const configuredContext = provider?.modelContextWindows?.[modelId]
  const normalizedConfiguredContext = normalizeContextWindowTokens(configuredContext)
  if (normalizedConfiguredContext) {
    return { tokens: normalizedConfiguredContext, source: 'configured' }
  }

  const catalogContext = provider?.models?.[modelId]?.limit.context
  const normalizedCatalogContext = normalizeContextWindowTokens(catalogContext)
  if (normalizedCatalogContext) {
    return { tokens: normalizedCatalogContext, source: 'model-catalog' }
  }

  return getContextWindowInfo(modelId, provider?.modelContextWindows?.[modelId])
}
