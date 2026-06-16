import { BrowserWindow } from 'electron'
import { ChatCompletionMessage } from '../shared/types'
import { callModel, getPromptCacheStats } from './agent/callModel'
import { loadMemoryContextPrompt } from './agent/memoryContext'
import { injectMemoryContext } from './agent/memoryPrompts'
import { estimateTokens } from './agent/tokenEstimator'

interface ModelItem {
  id?: string
  name?: string
  model?: string
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
    messages: ChatCompletionMessage[]
    sessionId?: string
  }
): Promise<void> {
  const { apiUrl, apiKey, model, messages } = options
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
      { apiUrl, apiKey, model },
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

export async function fetchModels(fetchUrl: string, apiKey: string): Promise<string[]> {
  if (!fetchUrl) return []
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    const response = await fetch(fetchUrl, { method: 'GET', headers })
    if (!response.ok) {
      throw new Error(`获取失败：${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as FetchModelsResponse | ModelItem[] | string[]
    let modelIds: string[] = []

    if (data && typeof data === 'object') {
      if ('data' in data && Array.isArray(data.data)) {
        modelIds = data.data.map((m) => m.id || '').filter(Boolean)
      } else if ('models' in data && Array.isArray(data.models)) {
        modelIds = data.models.map((m) => m.name || m.model || m.id || '').filter(Boolean)
      } else if (Array.isArray(data)) {
        modelIds = (data as (ModelItem | string)[])
          .map((m) => {
            if (typeof m === 'string') return m
            return m.id || m.name || m.model || ''
          })
          .filter(Boolean)
      }
    }
    return modelIds
  } catch (error) {
    const err = error as Error
    console.error('Fetch models error:', err)
    throw new Error(err.message || '网络连接异常')
  }
}
