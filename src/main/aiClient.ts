import { BrowserWindow } from 'electron'
import { ChatCompletionMessage } from '../shared/types'

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
  options: { apiUrl: string; apiKey: string; model: string; messages: ChatCompletionMessage[] }
): Promise<void> {
  const { apiUrl, apiKey, model, messages } = options
  const completionsUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`
  const controller = new AbortController()
  activeChatSessions.set(reqId, controller)

  try {
    const response = await fetch(completionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errText || response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Failed to get readable stream reader')

    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const cleanLine = line.trim()
        if (!cleanLine) continue
        if (cleanLine === 'data: [DONE]') {
          mainWindow.webContents.send('chat-chunk', { reqId, done: true })
          return
        }

        if (cleanLine.startsWith('data: ')) {
          try {
            const json = JSON.parse(cleanLine.substring(6))
            const reasoningContent = (json.choices?.[0]?.delta?.reasoning_content as string) || ''
            const content = (json.choices?.[0]?.delta?.content as string) || ''

            if (reasoningContent || content) {
              mainWindow.webContents.send('chat-chunk', {
                reqId,
                content,
                reasoningContent
              })
            }
          } catch {
            // Parse error on incomplete JSON chunks
          }
        }
      }
    }
    // Stream completed
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Chat Completion Main process error:', err)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || '网络连接失败' })
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
