import { BrowserWindow } from 'electron'
import { ChatCompletionMessage, FetchedModelInfo, ModelRuntimeConfig } from '../shared/types'
import { callModel, getPromptCacheStats } from './agent/callModel'
import { loadMemoryContextPrompt } from './agent/memoryContext'
import { injectMemoryContext } from './agent/memoryPrompts'
import { estimateTokens } from './agent/tokenEstimator'

interface ModelItem {
  id?: string
  name?: string
  model?: string
  display_name?: string
  displayName?: string
  context_length?: number | string
  context_window?: number | string
  contextWindow?: number | string
  contextWindowTokens?: number | string
  max_context_length?: number | string
  max_context_tokens?: number | string
  max_context_window?: number | string
  max_input_tokens?: number | string
  input_token_limit?: number | string
  max_model_len?: number | string
  max_sequence_length?: number | string
}

interface FetchModelsResponse {
  data?: ModelItem[]
  models?: ModelItem[]
}

const activeChatSessions = new Map<string, AbortController>()

export function abortChatCompletion(reqId: string): void {
  const controller = activeChatSessions.get(reqId)
  if (controller) {
    controller.abort()
    activeChatSessions.delete(reqId)
  }
}

export async function handleChatCompletion(
  mainWindow: BrowserWindow,
  reqId: string,
  options: {
    apiUrl: string
    apiKey: string
    model: string
    modelRuntime?: ModelRuntimeConfig
    messages: ChatCompletionMessage[]
    sessionId?: string
  }
): Promise<void> {
  const { apiUrl, apiKey, model, modelRuntime, messages } = options
  const controller = new AbortController()
  activeChatSessions.set(reqId, controller)

  try {
    const memoryPrompt = loadMemoryContextPrompt()
    const messagesWithMemory = injectMemoryContext(messages, memoryPrompt)

    // Plain chat is a single model call with no tools. Reuse the agent's SSE parser
    // (callModel) as the single source of truth — it also splits local <think> tags
    // into reasoning, which the previous inline parser ignored.
    const startTime = Date.now()
    const assistantMessage = await callModel(
      { apiUrl, apiKey, model, modelRuntime },
      messagesWithMemory,
      undefined,
      controller.signal,
      {
        onReasoning: (reasoningContent) => {
          mainWindow.webContents.send('chat-chunk', { reqId, reasoningContent })
        },
        onFinalChunk: (content) => {
          mainWindow.webContents.send('chat-chunk', { reqId, content })
        }
      }
    )
    const durationSec = (Date.now() - startTime) / 1000
    const reasoningText = assistantMessage.reasoning_content || ''
    const contentText = typeof assistantMessage.content === 'string' ? assistantMessage.content : ''
    const tokens = estimateTokens(reasoningText) + estimateTokens(contentText)
    const tokenSpeed = durationSec > 0 ? Number((tokens / durationSec).toFixed(1)) : 0

    const cacheStats = getPromptCacheStats(assistantMessage)
    mainWindow.webContents.send('chat-chunk', {
      reqId,
      done: true,
      tokenSpeed,
      ...(cacheStats ? { cacheStats } : {})
    })
  } catch (error) {
    const err = error as Error
    const isAborted = controller.signal.aborted || err.name === 'AbortError'
    if (isAborted) {
      mainWindow.webContents.send('chat-chunk', { reqId, cancelled: true, done: true })
    } else {
      console.error('Chat Completion Main process error:', err)
      mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || '网络连接失败' })
    }
  } finally {
    activeChatSessions.delete(reqId)
  }
}

const CONTEXT_FIELD_NAMES = [
  'context_length',
  'context_window',
  'contextWindow',
  'contextWindowTokens',
  'max_context_length',
  'max_context_tokens',
  'max_context_window',
  'max_input_tokens',
  'input_token_limit',
  'max_model_len',
  'max_sequence_length'
]

function normalizeFetchedContextTokens(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined
  const rounded = Math.round(numeric)
  if (rounded < 2000 || rounded > 10000000) return undefined
  return rounded
}

function getFetchedModelContextTokens(model: ModelItem): number | undefined {
  const record = model as Record<string, unknown>
  for (const field of CONTEXT_FIELD_NAMES) {
    const normalized = normalizeFetchedContextTokens(record[field])
    if (normalized) return normalized
  }
  return undefined
}

function normalizeFetchedModel(item: ModelItem | string): FetchedModelInfo | undefined {
  if (typeof item === 'string') {
    const id = item.trim()
    return id ? { id } : undefined
  }

  const id = (item.id || item.name || item.model || '').trim()
  if (!id) return undefined
  const displayName = (item.displayName || item.display_name || '').trim() || undefined
  const contextWindowTokens = getFetchedModelContextTokens(item)
  return {
    id,
    ...(displayName ? { displayName } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {})
  }
}

function uniqueFetchedModels(models: FetchedModelInfo[]): FetchedModelInfo[] {
  const seen = new Set<string>()
  const result: FetchedModelInfo[] = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    result.push(model)
  }
  return result
}

export async function fetchModels(fetchUrl: string, apiKey: string): Promise<FetchedModelInfo[]> {
  if (!fetchUrl) return []
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    const response = await fetch(fetchUrl, { method: 'GET', headers })
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
    }

    let data: FetchModelsResponse | ModelItem[] | string[]
    if (typeof response.text === 'function') {
      const text = await response.text()
      try {
        data = JSON.parse(text) as FetchModelsResponse | ModelItem[] | string[]
      } catch {
        const snippet = text.trim().slice(0, 100)
        throw new Error(
          `Failed to parse models response as JSON. Response body starts with: "${snippet}"`
        )
      }
    } else {
      data = (await response.json()) as FetchModelsResponse | ModelItem[] | string[]
    }

    let models: FetchedModelInfo[] = []

    if (data && typeof data === 'object') {
      if ('data' in data && Array.isArray(data.data)) {
        models = data.data.map(normalizeFetchedModel).filter(Boolean) as FetchedModelInfo[]
      } else if ('models' in data && Array.isArray(data.models)) {
        models = data.models.map(normalizeFetchedModel).filter(Boolean) as FetchedModelInfo[]
      } else if (Array.isArray(data)) {
        models = (data as (ModelItem | string)[])
          .map(normalizeFetchedModel)
          .filter(Boolean) as FetchedModelInfo[]
      }
    }
    return uniqueFetchedModels(models)
  } catch (error) {
    const err = error as Error
    console.error('Fetch models error:', err)
    throw new Error(err.message || 'Network error')
  }
}
