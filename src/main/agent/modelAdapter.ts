import {
  ApiProvider,
  ChatCompletionMessage,
  ProviderApiFormat,
  ProviderEndpointType,
  ResolvedModelFeatureSupport
} from '../../shared/types'
import { getProviderRuntimeProfile } from '../../shared/providerProfiles'

/**
 * Per-provider API compatibility adapter. Different LLM providers deviate from the OpenAI
 * spec in small but breaking ways — extra fields they reject, different tool_choice values,
 * stricter content requirements. This layer sanitises messages and request bodies before
 * they hit the wire so callModel stays provider-agnostic.
 */
export interface ModelAdapter {
  readonly name: string
  readonly features: ResolvedModelFeatureSupport
  readonly apiFormats: readonly ProviderApiFormat[]

  /** Clean messages before sending. Must not mutate the input array. */
  sanitizeMessages(msgs: ChatCompletionMessage[]): ChatCompletionMessage[]

  /** Adjust the request body (tool_choice, etc.) before JSON.stringify. */
  sanitizeBody(body: Record<string, unknown>): Record<string, unknown>

  /** Resolve the protocol-specific URL and authentication headers. */
  buildRequestTarget(options: { apiUrl: string; apiKey: string; apiFormat: ProviderApiFormat }): {
    url: string
    headers: Record<string, string>
  }
}

const adapterFeatures = (type: ApiProvider['type']): ResolvedModelFeatureSupport => ({
  ...getProviderRuntimeProfile(type).features
})

const buildOpenAiRequestTarget: ModelAdapter['buildRequestTarget'] = ({
  apiUrl,
  apiKey,
  apiFormat
}) => ({
  url: `${apiUrl.replace(/\/$/, '')}/${apiFormat === 'responses' ? 'responses' : 'chat/completions'}`,
  headers: {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }
})

// ---- Helpers ----

function cloneMessage(m: ChatCompletionMessage): ChatCompletionMessage {
  return { ...m, tool_calls: m.tool_calls ? [...m.tool_calls] : undefined }
}

/** Strip `reasoning_content` from every message — used by providers that reject unknown fields. */
function stripReasoningContent(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (!('reasoning_content' in m)) return m
    const copy = cloneMessage(m)
    delete copy.reasoning_content
    return copy
  })
}

/** For assistant messages that carry tool_calls, delete empty-string `content` rather than
 *  sending `"content": ""` which some providers (GLM) reject. */
function normalizeEmptyContent(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (m.role === 'assistant' && m.content === '' && m.tool_calls && m.tool_calls.length > 0) {
      const copy = cloneMessage(m)
      delete copy.content
      return copy
    }
    return m
  })
}

/** Delete empty `tool_calls: []` arrays — some providers reject them as unknown payload. */
function stripEmptyToolCalls(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length === 0) {
      const copy = cloneMessage(m)
      delete copy.tool_calls
      if (copy.content === undefined) copy.content = ''
      return copy
    }
    return m
  })
}

/** Delete the optional `name` field from tool-role messages. It is redundant with
 *  `tool_call_id` and some providers (GLM) reject unknown fields strictly. */
function stripToolMessageName(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (m.role === 'tool' && 'name' in m) {
      const copy = { ...m }
      delete (copy as Record<string, unknown>).name
      return copy
    }
    return m
  })
}

// ---- Open-AI-compatible adapter (baseline, no changes needed) ----

const openaiAdapter: ModelAdapter = {
  name: 'openai',
  features: adapterFeatures('custom'),
  apiFormats: ['chat-completions', 'responses'],
  sanitizeMessages: stripReasoningContent,
  sanitizeBody: (body) => body,
  buildRequestTarget: buildOpenAiRequestTarget
}

const sanitizeStrictOpenAiCompatibleMessages = (
  msgs: ChatCompletionMessage[]
): ChatCompletionMessage[] => {
  let cleaned = stripReasoningContent(msgs)
  cleaned = stripToolMessageName(cleaned)
  cleaned = normalizeEmptyContent(cleaned)
  cleaned = stripEmptyToolCalls(cleaned)
  return cleaned
}

const createStrictOpenAiCompatibleAdapter = (
  name: string,
  type: ApiProvider['type']
): ModelAdapter => ({
  name,
  features: adapterFeatures(type),
  apiFormats: ['chat-completions'],
  sanitizeMessages: sanitizeStrictOpenAiCompatibleMessages,
  sanitizeBody: (body) => body,
  buildRequestTarget: buildOpenAiRequestTarget
})

// ---- DeepSeek adapter ----

const deepseekAdapter: ModelAdapter = {
  name: 'deepseek',
  features: adapterFeatures('deepseek'),
  apiFormats: ['chat-completions'],
  sanitizeMessages: stripReasoningContent,
  sanitizeBody: (body) => body,
  buildRequestTarget: buildOpenAiRequestTarget
}

// ---- Kimi (Moonshot) adapter ----

const kimiAdapter: ModelAdapter = {
  name: 'kimi',
  features: adapterFeatures('kimi'),
  apiFormats: ['chat-completions'],
  sanitizeMessages: stripReasoningContent,
  sanitizeBody: (body) => body,
  buildRequestTarget: buildOpenAiRequestTarget
}

// ---- opencode adapter ----

const opencodeAdapter = createStrictOpenAiCompatibleAdapter('opencode', 'opencode')

// ---- GLM (Zhipu) adapter ----

const glmAdapter: ModelAdapter = {
  name: 'glm',
  features: adapterFeatures('glm'),
  apiFormats: ['chat-completions'],
  sanitizeMessages: (msgs) => {
    // GLM rejects non-standard fields strictly. Strip everything it doesn't recognise.
    let cleaned = stripReasoningContent(msgs)
    cleaned = stripToolMessageName(cleaned)
    cleaned = normalizeEmptyContent(cleaned)
    cleaned = stripEmptyToolCalls(cleaned)
    return cleaned
  },
  sanitizeBody: (body) => {
    // GLM auto-enables tools when `tools` is present and does not recognise `tool_choice: "auto"`.
    if ('tool_choice' in body && body.tool_choice === 'auto') {
      const copy = { ...body }
      delete copy.tool_choice
      return copy
    }
    return body
  },
  buildRequestTarget: buildOpenAiRequestTarget
}

// ---- Xiaomi MiMo adapter ----

const mimoAdapter = createStrictOpenAiCompatibleAdapter('mimo', 'mimo')

const stepAdapter: ModelAdapter = {
  name: 'step',
  features: adapterFeatures('step'),
  apiFormats: ['chat-completions'],
  sanitizeMessages: sanitizeStrictOpenAiCompatibleMessages,
  sanitizeBody: (body) => {
    const model = String(body.model || '').toLowerCase()
    if (
      model.includes('flash') ||
      model.includes('r-mini') ||
      model.includes('reason') ||
      model.includes('router')
    ) {
      return {
        ...body,
        reasoning_format: 'deepseek-style'
      }
    }
    return body
  },
  buildRequestTarget: buildOpenAiRequestTarget
}

// ---- Ollama adapter ----

const ollamaAdapter: ModelAdapter = {
  name: 'ollama',
  features: adapterFeatures('ollama'),
  apiFormats: ['chat-completions'],
  sanitizeMessages: (msgs) => {
    // Ollama is lenient but reasoning_content may confuse some models.
    return stripReasoningContent(msgs)
  },
  sanitizeBody: (body) => {
    // Ollama's OpenAI-compat layer doesn't support tool_choice.
    if ('tool_choice' in body) {
      const copy = { ...body }
      delete copy.tool_choice
      return copy
    }
    return body
  },
  buildRequestTarget: buildOpenAiRequestTarget
}

// ---- Provider detection ----

const ADAPTERS: Record<string, ModelAdapter> = {
  opencode: opencodeAdapter,
  deepseek: deepseekAdapter,
  kimi: kimiAdapter,
  glm: glmAdapter,
  ollama: ollamaAdapter,
  mimo: mimoAdapter,
  step: stepAdapter
}

/**
 * Heuristically detect the provider type from the API base URL so callers don't have to
 * thread a `providerType` param through the entire stack. Falls back to the permissive
 * OpenAI adapter when the URL doesn't match any known provider.
 */
export function detectProvider(apiUrl: string): ModelAdapter {
  const url = apiUrl.toLowerCase()
  if (url.includes('opencode')) return opencodeAdapter
  if (url.includes('deepseek')) return deepseekAdapter
  if (url.includes('moonshot') || url.includes('kimi')) return kimiAdapter
  if (url.includes('bigmodel') || url.includes('glm') || url.includes('zhipu')) return glmAdapter
  if (url.includes('ollama') || url.includes(':11434')) return ollamaAdapter
  if (url.includes('mimo') || url.includes('xiaomi')) return mimoAdapter
  if (url.includes('stepfun') || url.includes('step.ai') || url.includes('step_plan'))
    return stepAdapter
  return openaiAdapter
}

/** Look up adapter by explicit provider type string (for callers that DO have the type). */
export function getAdapter(
  providerType?: string,
  endpointType?: ProviderEndpointType
): ModelAdapter {
  if (providerType && ADAPTERS[providerType]) return ADAPTERS[providerType]
  if (endpointType === 'ollama-openai') return ollamaAdapter
  return openaiAdapter
}
