import { ChatCompletionMessage } from '../../shared/types'

/**
 * Per-provider API compatibility adapter. Different LLM providers deviate from the OpenAI
 * spec in small but breaking ways — extra fields they reject, different tool_choice values,
 * stricter content requirements. This layer sanitises messages and request bodies before
 * they hit the wire so callModel stays provider-agnostic.
 */
export interface ModelAdapter {
  readonly name: string

  /** Clean messages before sending. Must not mutate the input array. */
  sanitizeMessages(msgs: ChatCompletionMessage[]): ChatCompletionMessage[]

  /** Adjust the request body (tool_choice, etc.) before JSON.stringify. */
  sanitizeBody(body: Record<string, unknown>): Record<string, unknown>
}

// ---- Helpers ----

function cloneMessage(m: ChatCompletionMessage): ChatCompletionMessage {
  return { ...m, tool_calls: m.tool_calls ? [...m.tool_calls] : undefined }
}

/** Strip `reasoning_content` from every message — used by providers that reject unknown fields. */
function stripReasoningContent(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (m.reasoning_content === undefined || m.reasoning_content === '') return m
    const copy = cloneMessage(m)
    delete copy.reasoning_content
    return copy
  })
}

/** For assistant messages that carry tool_calls, delete empty-string `content` rather than
 *  sending `"content": ""` which some providers (GLM) reject. */
function normalizeEmptyContent(msgs: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return msgs.map((m) => {
    if (
      m.role === 'assistant' &&
      m.content === '' &&
      m.tool_calls &&
      m.tool_calls.length > 0
    ) {
      const copy = cloneMessage(m)
      delete copy.content
      return copy
    }
    return m
  })
}

// ---- Open-AI-compatible adapter (baseline, no changes needed) ----

const openaiAdapter: ModelAdapter = {
  name: 'openai',
  sanitizeMessages: (msgs) => msgs,
  sanitizeBody: (body) => body
}

// ---- DeepSeek adapter ----

const deepseekAdapter: ModelAdapter = {
  name: 'deepseek',
  sanitizeMessages: (msgs) => msgs, // DeepSeek accepts reasoning_content
  sanitizeBody: (body) => body
}

// ---- Kimi (Moonshot) adapter ----

const kimiAdapter: ModelAdapter = {
  name: 'kimi',
  sanitizeMessages: (msgs) => msgs,
  sanitizeBody: (body) => body
}

// ---- GLM (Zhipu) adapter ----

const glmAdapter: ModelAdapter = {
  name: 'glm',
  sanitizeMessages: (msgs) => {
    // GLM rejects non-standard fields strictly.
    let cleaned = stripReasoningContent(msgs)
    cleaned = normalizeEmptyContent(cleaned)
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
  }
}

// ---- Ollama adapter ----

const ollamaAdapter: ModelAdapter = {
  name: 'ollama',
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
  }
}

// ---- Provider detection ----

const ADAPTERS: Record<string, ModelAdapter> = {
  deepseek: deepseekAdapter,
  kimi: kimiAdapter,
  glm: glmAdapter,
  ollama: ollamaAdapter
}

/**
 * Heuristically detect the provider type from the API base URL so callers don't have to
 * thread a `providerType` param through the entire stack. Falls back to the permissive
 * OpenAI adapter when the URL doesn't match any known provider.
 */
export function detectProvider(apiUrl: string): ModelAdapter {
  const url = apiUrl.toLowerCase()
  if (url.includes('deepseek')) return deepseekAdapter
  if (url.includes('moonshot') || url.includes('kimi')) return kimiAdapter
  if (url.includes('bigmodel') || url.includes('glm') || url.includes('zhipu')) return glmAdapter
  if (url.includes('ollama') || url.includes(':11434')) return ollamaAdapter
  return openaiAdapter
}

/** Look up adapter by explicit provider type string (for callers that DO have the type). */
export function getAdapter(providerType?: string): ModelAdapter {
  if (providerType && ADAPTERS[providerType]) return ADAPTERS[providerType]
  return openaiAdapter
}
