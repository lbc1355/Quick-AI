import {
  ChatCompletionMessage,
  ChatToolDeclaration,
  ModelRuntimeConfig,
  PromptCacheStats,
  ProviderEndpointType,
  ProviderApiFormat,
  ResolvedModelFeatureSupport
} from '../../shared/types'
import { detectProvider, getAdapter, ModelAdapter } from './modelAdapter'
import { callChatCompletionsModel } from './callChatCompletionsModel'
import { callResponsesModel } from './callResponsesModel'

export interface CallModelOptions {
  apiUrl: string
  apiKey: string
  model: string
  providerType?: ModelRuntimeConfig['providerType']
  endpointType?: ProviderEndpointType
  modelRuntime?: ModelRuntimeConfig
  apiFormat?: ProviderApiFormat
}

export interface CallModelCallbacks {
  onReasoning: (content: string) => void
  onFinalChunk: (content: string) => void
  onToolCallProgress?: (progress: ToolCallStreamProgress) => void
}

export interface ToolCallStreamProgress {
  index: number
  id?: string
  toolName?: string
  argumentsLength: number
  argumentsDeltaLength: number
  generatedLineCount: number
}

export const TOOL_CALL_PROGRESS_CHAR_INTERVAL = 4096
export const TOOL_CALL_PROGRESS_LINE_INTERVAL = 25
const FILE_WRITE_CONTENT_ARGUMENT_PATTERN = /"content"\s*:\s*"/

export const countGeneratedArgumentLines = (
  toolName: string | undefined,
  argumentsText: string
): number => {
  const contentMatch =
    toolName === 'file_write' ? argumentsText.match(FILE_WRITE_CONTENT_ARGUMENT_PATTERN) : null
  const source =
    contentMatch?.index === undefined
      ? argumentsText
      : argumentsText.slice(contentMatch.index + contentMatch[0].length)
  if (!source) return 0

  const actualNewlines = source.match(/\r\n|\r|\n/g)?.length || 0
  const escapedNewlines = source.match(/\\n/g)?.length || 0
  return actualNewlines + escapedNewlines + 1
}

export const promptCacheStatsByMessage = new WeakMap<ChatCompletionMessage, PromptCacheStats>()

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function getPromptCacheStats(message: ChatCompletionMessage): PromptCacheStats | undefined {
  return promptCacheStatsByMessage.get(message)
}

export function extractPromptCacheStats(usage: unknown): PromptCacheStats | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const promptDetails =
    u.prompt_tokens_details && typeof u.prompt_tokens_details === 'object'
      ? (u.prompt_tokens_details as Record<string, unknown>)
      : undefined
  const inputDetails =
    u.input_tokens_details && typeof u.input_tokens_details === 'object'
      ? (u.input_tokens_details as Record<string, unknown>)
      : undefined
  const completionDetails =
    u.completion_tokens_details && typeof u.completion_tokens_details === 'object'
      ? (u.completion_tokens_details as Record<string, unknown>)
      : undefined
  const outputDetails =
    u.output_tokens_details && typeof u.output_tokens_details === 'object'
      ? (u.output_tokens_details as Record<string, unknown>)
      : undefined

  const promptTokens = asNumber(u.prompt_tokens) ?? asNumber(u.input_tokens)
  const completionTokens = asNumber(u.completion_tokens) ?? asNumber(u.output_tokens)
  const totalTokens = asNumber(u.total_tokens)
  const reasoningTokens =
    asNumber(u.reasoning_tokens) ??
    asNumber(completionDetails?.reasoning_tokens) ??
    asNumber(outputDetails?.reasoning_tokens)
  const hitTokensRaw =
    asNumber(u.prompt_cache_hit_tokens) ??
    asNumber(u.cache_hit_tokens) ??
    asNumber(promptDetails?.cached_tokens) ??
    asNumber(inputDetails?.cached_tokens)
  let missTokens = asNumber(u.prompt_cache_miss_tokens) ?? asNumber(u.cache_miss_tokens)
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

export function prepareMessagesForModel(
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] {
  return messages.map((m) => {
    if (!('reasoning_content' in m)) return m

    const copy = { ...m }
    delete copy.reasoning_content
    if (m.role === 'assistant' && copy.tool_calls) {
      copy.tool_calls = [...copy.tool_calls]
    }
    return copy
  })
}

export function resolveModelAdapter(options: CallModelOptions): ModelAdapter {
  const providerType = options.modelRuntime?.providerType ?? options.providerType
  const endpointType = options.modelRuntime?.endpointType ?? options.endpointType

  if (providerType || endpointType) {
    return getAdapter(providerType, endpointType)
  }

  return detectProvider(options.apiUrl)
}

export function getRequestModelId(options: CallModelOptions): string {
  return options.modelRuntime?.apiModel?.trim() || options.model
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

export function resolveApiFormat(options: CallModelOptions): ProviderApiFormat {
  const format = options.modelRuntime?.apiFormat ?? options.apiFormat ?? 'chat-completions'
  const adapter = resolveModelAdapter(options)
  if (!adapter.apiFormats.includes(format)) {
    throw new Error(`Provider adapter "${adapter.name}" does not support the ${format} API format.`)
  }
  return format
}

export async function callModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const format = resolveApiFormat(options)
  if (format === 'responses') {
    return callResponsesModel(options, messages, toolsToDeclare, signal, callbacks)
  }
  return callChatCompletionsModel(options, messages, toolsToDeclare, signal, callbacks)
}
