import {
  ApiProvider,
  ChatCompletionMessage,
  ModelCompatibilityProfile,
  ProviderApiFormat,
  ProviderEndpointType,
  ResolvedModelCompatibilityProfile,
  ResolvedModelFeatureSupport,
  ResolvedProviderStreamPolicy
} from '../../shared/types'
import {
  getProviderRuntimeProfile,
  PROVIDER_RUNTIME_PROFILES,
  resolveModelCompatibility,
  transportIdToApiFormat
} from '../../shared/providerProfiles'

/**
 * Resolved provider/model compatibility policy. Protocol execution and endpoint construction live
 * in model transports; this adapter only applies typed provider quirks before a request is sent.
 */
export interface ModelAdapter {
  readonly name: string
  readonly features: ResolvedModelFeatureSupport
  readonly apiFormats: readonly ProviderApiFormat[]
  readonly compatibility: ResolvedModelCompatibilityProfile
  readonly streamPolicy: ResolvedProviderStreamPolicy

  /** Clean messages before sending. Must not mutate the input array. */
  sanitizeMessages(msgs: ChatCompletionMessage[]): ChatCompletionMessage[]

  /** Apply provider/model compatibility options to a transport request body. */
  sanitizeBody(body: Record<string, unknown>): Record<string, unknown>
}

function cloneMessage(message: ChatCompletionMessage): ChatCompletionMessage {
  return {
    ...message,
    tool_calls: message.tool_calls ? [...message.tool_calls] : undefined
  }
}

function applyMessageCompatibility(
  messages: ChatCompletionMessage[],
  compatibility: ResolvedModelCompatibilityProfile
): ChatCompletionMessage[] {
  return messages.map((message) => {
    let copy: ChatCompletionMessage | undefined
    const mutable = (): ChatCompletionMessage => {
      copy ||= cloneMessage(message)
      return copy
    }

    const preserveToolCallReasoning =
      compatibility.preserveToolCallReasoningContent &&
      message.role === 'assistant' &&
      !!message.tool_calls?.length
    if (
      compatibility.stripReasoningContent &&
      !preserveToolCallReasoning &&
      'reasoning_content' in message
    ) {
      delete mutable().reasoning_content
    }

    if (compatibility.stripToolMessageName && message.role === 'tool' && 'name' in message) {
      delete (mutable() as unknown as Record<string, unknown>).name
    }

    if (
      compatibility.normalizeToolCallContent &&
      message.role === 'assistant' &&
      message.content === '' &&
      message.tool_calls &&
      message.tool_calls.length > 0
    ) {
      delete mutable().content
    }

    if (
      compatibility.stripEmptyToolCalls &&
      message.role === 'assistant' &&
      message.tool_calls &&
      message.tool_calls.length === 0
    ) {
      const target = mutable()
      delete target.tool_calls
      if (target.content === undefined) target.content = ''
    }

    return copy || message
  })
}

function applyBodyCompatibility(
  body: Record<string, unknown>,
  compatibility: ResolvedModelCompatibilityProfile
): Record<string, unknown> {
  let result = body
  const mutable = (): Record<string, unknown> => {
    if (result === body) result = { ...body }
    return result
  }

  if (compatibility.omitToolChoice && 'tool_choice' in body) {
    delete mutable().tool_choice
  }

  if (compatibility.reasoningFormat) {
    mutable().reasoning_format = compatibility.reasoningFormat
  }

  return result
}

function createAdapter(
  type: ApiProvider['type'],
  modelId = '',
  compatibilityOverride?: ModelCompatibilityProfile
): ModelAdapter {
  const runtimeProfile = getProviderRuntimeProfile(type)
  const compatibility = {
    ...resolveModelCompatibility(
      { type },
      {
        id: modelId,
        apiId: modelId
      }
    ),
    ...(compatibilityOverride || {})
  }

  return {
    name: type === 'custom' ? 'openai' : type,
    features: { ...runtimeProfile.features },
    apiFormats: runtimeProfile.supportedTransports.map(transportIdToApiFormat),
    compatibility,
    streamPolicy: { ...runtimeProfile.streamPolicy },
    sanitizeMessages: (messages) => applyMessageCompatibility(messages, compatibility),
    sanitizeBody: (body) => applyBodyCompatibility(body, compatibility)
  }
}

function isProviderType(value: string): value is ApiProvider['type'] {
  return value in PROVIDER_RUNTIME_PROFILES
}

function detectProviderType(apiUrl: string): ApiProvider['type'] {
  const url = apiUrl.toLowerCase()
  if (url.includes('opencode')) return 'opencode'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('moonshot') || url.includes('kimi')) return 'kimi'
  if (url.includes('bigmodel') || url.includes('glm') || url.includes('zhipu')) return 'glm'
  if (url.includes('ollama') || url.includes(':11434')) return 'ollama'
  if (url.includes('mimo') || url.includes('xiaomi')) return 'mimo'
  if (url.includes('stepfun') || url.includes('step.ai') || url.includes('step_plan')) return 'step'
  return 'custom'
}

/** Legacy fallback for callers that have not resolved a model catalog entry yet. */
export function detectProvider(
  apiUrl: string,
  modelId = '',
  compatibilityOverride?: ModelCompatibilityProfile
): ModelAdapter {
  return createAdapter(detectProviderType(apiUrl), modelId, compatibilityOverride)
}

/** Resolve a compatibility adapter from explicit provider/model metadata. */
export function getAdapter(
  providerType?: string,
  endpointType?: ProviderEndpointType,
  modelId = '',
  compatibilityOverride?: ModelCompatibilityProfile
): ModelAdapter {
  const type =
    providerType && isProviderType(providerType)
      ? providerType
      : endpointType === 'ollama-openai'
        ? 'ollama'
        : 'custom'
  return createAdapter(type, modelId, compatibilityOverride)
}
