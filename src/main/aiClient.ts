import { BrowserWindow } from 'electron'
import {
  ChatCompletionMessage,
  FetchedModelInfo,
  ModelRuntimeConfig,
  ProviderConnectionDiagnosticCode,
  ProviderConnectionTestResult,
  ProviderModelDiscoveryRequest,
  ResolvedProviderConnection
} from '../shared/types'
import { normalizeRuntimeError } from '../shared/runtimeErrors'
import { callModel, getPromptCacheStats } from './agent/callModel'
import { loadMemoryContextPrompt } from './agent/memoryContext'
import { injectMemoryContext } from './agent/memoryPrompts'
import { estimateTokens } from './agent/tokenEstimator'
import { normalizeContextEpoch } from '../shared/contextEpoch'
import { buildProviderRequestHeaders } from './agent/modelRequestTarget'
import {
  getProviderModelDiscoveryPolicy,
  normalizeProviderModelDiscoveryResponse
} from '../shared/providerModelDiscovery'

const activeChatSessions = new Map<string, AbortController>()
const activeModelDiscoveries = new Map<string, Promise<FetchedModelInfo[]>>()
const PROVIDER_CONNECTION_TEST_TIMEOUT_MS = 15_000

class ProviderModelDiscoveryError extends Error {
  constructor(
    message: string,
    readonly code: ProviderConnectionDiagnosticCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderModelDiscoveryError'
  }
}

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
    providerConnection?: ResolvedProviderConnection
    model: string
    modelRuntime?: ModelRuntimeConfig
    messages: ChatCompletionMessage[]
    sessionId?: string
    contextEpoch?: number
  }
): Promise<void> {
  const { apiUrl, apiKey, providerConnection, model, modelRuntime, messages } = options
  const contextEpoch = normalizeContextEpoch(options.contextEpoch)
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
      { apiUrl, apiKey, providerConnection, model, modelRuntime },
      messagesWithMemory,
      undefined,
      controller.signal,
      {
        onReasoning: (reasoningContent) => {
          mainWindow.webContents.send('chat-chunk', { reqId, contextEpoch, reasoningContent })
        },
        onFinalChunk: (content) => {
          mainWindow.webContents.send('chat-chunk', { reqId, contextEpoch, content })
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
      contextEpoch,
      done: true,
      tokenSpeed,
      ...(cacheStats ? { cacheStats } : {})
    })
  } catch (error) {
    const err = error as Error
    const isAborted = controller.signal.aborted || err.name === 'AbortError'
    if (isAborted) {
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        contextEpoch,
        cancelled: true,
        done: true
      })
    } else {
      console.error('Chat Completion Main process error:', err)
      const payload = normalizeRuntimeError(err, 'model_api')
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        contextEpoch,
        error: err.message || '网络连接失败',
        errorPayload: payload
      })
    }
  } finally {
    activeChatSessions.delete(reqId)
  }
}

export function fetchModels(request: ProviderModelDiscoveryRequest): Promise<FetchedModelInfo[]> {
  const { fetchUrl, providerConnection, providerType } = request
  if (!fetchUrl) return Promise.resolve([])
  const discoveryKey = `${providerConnection.accountId}\n${providerType}\n${fetchUrl}`
  const active = activeModelDiscoveries.get(discoveryKey)
  if (active) return active

  const discovery = performModelDiscovery(request)
  activeModelDiscoveries.set(discoveryKey, discovery)
  void discovery.then(
    () => activeModelDiscoveries.delete(discoveryKey),
    () => activeModelDiscoveries.delete(discoveryKey)
  )
  return discovery
}

async function performModelDiscovery(
  request: ProviderModelDiscoveryRequest,
  signal?: AbortSignal
): Promise<FetchedModelInfo[]> {
  const { fetchUrl, providerConnection, providerType } = request
  try {
    const headers = buildProviderRequestHeaders(providerConnection, {
      'Content-Type': 'application/json'
    })
    const response = await fetch(fetchUrl, {
      method: 'GET',
      headers,
      ...(signal ? { signal } : {})
    })
    if (!response.ok) {
      throw new ProviderModelDiscoveryError(
        `Fetch failed: ${response.status} ${response.statusText}`,
        classifyProviderHttpStatus(response.status),
        response.status
      )
    }

    let data: unknown
    if (typeof response.text === 'function') {
      const text = await response.text()
      try {
        data = JSON.parse(text) as unknown
      } catch {
        const snippet = text.trim().slice(0, 100)
        throw new ProviderModelDiscoveryError(
          `Failed to parse models response as JSON. Response body starts with: "${snippet}"`,
          'invalid_response'
        )
      }
    } else {
      data = await response.json()
    }
    return normalizeProviderModelDiscoveryResponse(
      data,
      getProviderModelDiscoveryPolicy(providerType)
    )
  } catch (error) {
    const err = error as Error
    console.error('Fetch models error:', err)
    if (err instanceof ProviderModelDiscoveryError) throw err
    throw error instanceof Error ? error : new Error(String(error || 'Network error'))
  }
}

function classifyProviderHttpStatus(status: number): ProviderConnectionDiagnosticCode {
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'http_error'
}

const getProviderConnectionFailure = (
  error: unknown
): {
  code: ProviderConnectionDiagnosticCode
  message: string
  status?: number
} => {
  if (error instanceof ProviderModelDiscoveryError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'timeout',
      message: `Connection test timed out after ${PROVIDER_CONNECTION_TEST_TIMEOUT_MS / 1000}s`
    }
  }
  const message = error instanceof Error ? error.message : String(error || 'Network error')
  return { code: 'network_error', message }
}

export async function testProviderConnection(
  request: ProviderModelDiscoveryRequest
): Promise<ProviderConnectionTestResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_CONNECTION_TEST_TIMEOUT_MS)
  try {
    const models = await performModelDiscovery(request, controller.signal)
    const checkedAt = Date.now()
    if (models.length === 0) {
      return {
        ok: false,
        code: 'empty_catalog',
        message: 'Connection succeeded, but the endpoint returned no models',
        endpoint: request.fetchUrl,
        checkedAt,
        latencyMs: checkedAt - startedAt,
        modelCount: 0
      }
    }
    return {
      ok: true,
      code: 'ok',
      message: `Connection succeeded and returned ${models.length} models`,
      endpoint: request.fetchUrl,
      checkedAt,
      latencyMs: checkedAt - startedAt,
      modelCount: models.length
    }
  } catch (error) {
    const checkedAt = Date.now()
    return {
      ok: false,
      ...getProviderConnectionFailure(error),
      endpoint: request.fetchUrl,
      checkedAt,
      latencyMs: checkedAt - startedAt
    }
  } finally {
    clearTimeout(timeout)
  }
}
