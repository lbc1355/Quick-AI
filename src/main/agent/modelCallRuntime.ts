import {
  ChatCompletionMessage,
  ModelTransportId,
  PromptCacheStats,
  ProviderApiFormat,
  ResolvedModelFeatureSupport
} from '../../shared/types'
import { apiFormatToTransportId, transportIdToApiFormat } from '../../shared/providerProfiles'
import { detectProvider, getAdapter, ModelAdapter } from './modelAdapter'
import type { CallModelOptions } from './modelCallTypes'

export const promptCacheStatsByMessage = new WeakMap<ChatCompletionMessage, PromptCacheStats>()

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function getPromptCacheStats(message: ChatCompletionMessage): PromptCacheStats | undefined {
  return promptCacheStatsByMessage.get(message)
}

export function extractPromptCacheStats(usage: unknown): PromptCacheStats | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const source = usage as Record<string, unknown>
  const promptDetails =
    source.prompt_tokens_details && typeof source.prompt_tokens_details === 'object'
      ? (source.prompt_tokens_details as Record<string, unknown>)
      : undefined
  const inputDetails =
    source.input_tokens_details && typeof source.input_tokens_details === 'object'
      ? (source.input_tokens_details as Record<string, unknown>)
      : undefined
  const completionDetails =
    source.completion_tokens_details && typeof source.completion_tokens_details === 'object'
      ? (source.completion_tokens_details as Record<string, unknown>)
      : undefined
  const outputDetails =
    source.output_tokens_details && typeof source.output_tokens_details === 'object'
      ? (source.output_tokens_details as Record<string, unknown>)
      : undefined

  const promptTokens = asNumber(source.prompt_tokens) ?? asNumber(source.input_tokens)
  const completionTokens = asNumber(source.completion_tokens) ?? asNumber(source.output_tokens)
  const totalTokens = asNumber(source.total_tokens)
  const reasoningTokens =
    asNumber(source.reasoning_tokens) ??
    asNumber(completionDetails?.reasoning_tokens) ??
    asNumber(outputDetails?.reasoning_tokens)
  const hitTokensRaw =
    asNumber(source.prompt_cache_hit_tokens) ??
    asNumber(source.cache_hit_tokens) ??
    asNumber(promptDetails?.cached_tokens) ??
    asNumber(inputDetails?.cached_tokens)
  let missTokens = asNumber(source.prompt_cache_miss_tokens) ?? asNumber(source.cache_miss_tokens)
  const hasCacheStats = hitTokensRaw !== undefined || missTokens !== undefined

  if (
    !hasCacheStats &&
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined
  }

  const hitTokens = hitTokensRaw ?? 0
  if (hasCacheStats && missTokens === undefined && promptTokens !== undefined) {
    missTokens = Math.max(0, promptTokens - hitTokens)
  }

  const denominator = missTokens !== undefined ? hitTokens + missTokens : promptTokens
  const hitRate =
    hasCacheStats && denominator && denominator > 0
      ? Number(((hitTokens / denominator) * 100).toFixed(1))
      : 0

  return {
    hasCacheStats,
    promptTokens,
    completionTokens,
    totalTokens:
      totalTokens ??
      (promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined),
    reasoningTokens,
    cacheHitTokens: hitTokens,
    cacheMissTokens: missTokens,
    hitRate
  }
}

/** Legacy helper retained for callers/tests; resolved adapters now own this policy. */
export function prepareMessagesForModel(
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] {
  return messages.map((message) => {
    if (!('reasoning_content' in message)) return message
    const copy = { ...message }
    delete copy.reasoning_content
    if (message.role === 'assistant' && copy.tool_calls) copy.tool_calls = [...copy.tool_calls]
    return copy
  })
}

export function getRequestModelId(options: CallModelOptions): string {
  return options.modelRuntime?.apiModel?.trim() || options.model
}

export function resolveModelAdapter(options: CallModelOptions): ModelAdapter {
  const providerType = options.modelRuntime?.providerType ?? options.providerType
  const endpointType = options.modelRuntime?.endpointType ?? options.endpointType
  const modelId = getRequestModelId(options)
  const compatibility = options.modelRuntime?.compatibility

  if (providerType || endpointType) {
    return getAdapter(providerType, endpointType, modelId, compatibility)
  }
  return detectProvider(options.apiUrl, modelId, compatibility)
}

export function canUseTools(options: CallModelOptions): boolean {
  const featureOverride = options.modelRuntime?.features?.toolCalls
  if (featureOverride !== undefined) return featureOverride
  const capabilities = options.modelRuntime?.capabilities
  return !capabilities || capabilities.length === 0 || capabilities.includes('tools')
}

export function resolveModelFeatures(
  options: CallModelOptions,
  adapter: ModelAdapter = resolveModelAdapter(options)
): ResolvedModelFeatureSupport {
  const features = {
    ...adapter.features,
    ...(options.modelRuntime?.features || {})
  }
  if (!features.toolCalls) features.parallelToolCalls = false
  return features
}

export function resolveTransportId(options: CallModelOptions): ModelTransportId {
  const transportId =
    options.modelRuntime?.transportId ??
    options.transportId ??
    apiFormatToTransportId(
      options.modelRuntime?.apiFormat ?? options.apiFormat ?? 'chat-completions'
    )
  const format = transportIdToApiFormat(transportId)
  const adapter = resolveModelAdapter(options)
  if (!adapter.apiFormats.includes(format)) {
    throw new Error(`Provider adapter "${adapter.name}" does not support the ${format} API format.`)
  }
  return transportId
}

export function resolveApiFormat(options: CallModelOptions): ProviderApiFormat {
  return transportIdToApiFormat(resolveTransportId(options))
}
