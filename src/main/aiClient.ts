import { BrowserWindow } from 'electron'

export async function handleChatCompletion(
  mainWindow: BrowserWindow,
  reqId: string,
  options: { apiUrl: string; apiKey: string; model: string; messages: any[] }
) {
  const { apiUrl, apiKey, model, messages } = options
  const completionsUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`

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
      })
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
            const reasoningContent = json.choices[0]?.delta?.reasoning_content || ''
            const content = json.choices[0]?.delta?.content || ''

            if (reasoningContent || content) {
              mainWindow.webContents.send('chat-chunk', {
                reqId,
                content,
                reasoningContent
              })
            }
          } catch (e) {
            // Parse error on incomplete JSON chunks
          }
        }
      }
    }
    // Stream completed
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error: any) {
    console.error('Chat Completion Main process error:', error)
    mainWindow.webContents.send('chat-chunk', { reqId, error: error.message || '网络连接失败' })
  }
}
