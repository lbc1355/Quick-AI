import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'

export interface CallModelOptions {
  apiUrl: string
  apiKey: string
  model: string
}

export interface CallModelCallbacks {
  onReasoning: (content: string) => void
  onFinalChunk: (content: string) => void
}

export async function callModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  // Sanitize messages to strip reasoning_content from assistant messages (causes issues on OpenAI-compatible APIs)
  const sanitizedMessages = messages.map((m) => {
    if (m.role === 'assistant') {
      const copy = { ...m }
      delete copy.reasoning_content
      return copy
    }
    return m
  })

  const body: Record<string, unknown> = {
    model: options.model,
    messages: sanitizedMessages,
    stream: true
  }

  if (toolsToDeclare && toolsToDeclare.length > 0) {
    body.tools = toolsToDeclare
    body.tool_choice = 'auto'
  }

  const response = await fetch(completionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Failed to get readable stream reader')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const shouldStreamFinal = !toolsToDeclare || toolsToDeclare.length === 0

  const assistantMessage: ChatCompletionMessage = {
    role: 'assistant',
    content: '',
    reasoning_content: '',
    tool_calls: []
  }

  let inThinkTag = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const cleanLine = line.trim()
        if (!cleanLine) continue
        if (cleanLine === 'data: [DONE]') continue

        if (cleanLine.startsWith('data: ')) {
          try {
            const json = JSON.parse(cleanLine.substring(6))
            const delta = json.choices?.[0]?.delta
            if (!delta) continue

            // 1. Stream cloud model reasoning_content
            if (delta.reasoning_content) {
              assistantMessage.reasoning_content += delta.reasoning_content
              callbacks?.onReasoning(delta.reasoning_content)
            }

            // 2. Stream tool calls
            if (delta.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index
                if (!assistantMessage.tool_calls) assistantMessage.tool_calls = []
                if (!assistantMessage.tool_calls[idx]) {
                  assistantMessage.tool_calls[idx] = {
                    id: tcDelta.id || '',
                    type: 'function',
                    function: { name: tcDelta.function?.name || '', arguments: '' }
                  }
                }
                if (tcDelta.id) {
                  assistantMessage.tool_calls[idx].id = tcDelta.id
                }
                if (tcDelta.function?.name) {
                  assistantMessage.tool_calls[idx].function.name = tcDelta.function.name
                }
                if (tcDelta.function?.arguments) {
                  assistantMessage.tool_calls[idx].function.arguments += tcDelta.function.arguments
                }
              }
            }

            // 3. Stream text content (handling local <think> tags on the fly)
            if (delta.content) {
              let contentChunk = delta.content

              if (contentChunk.includes('<think>')) {
                inThinkTag = true
                const parts = contentChunk.split('<think>')
                if (parts[0]) {
                  if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                  assistantMessage.content += parts[0]
                  if (shouldStreamFinal) {
                    callbacks?.onFinalChunk(parts[0])
                  }
                }
                contentChunk = parts.slice(1).join('<think>')
              }

              if (inThinkTag) {
                if (contentChunk.includes('</think>')) {
                  inThinkTag = false
                  const parts = contentChunk.split('</think>')
                  if (parts[0]) {
                    assistantMessage.reasoning_content += parts[0]
                    callbacks?.onReasoning(parts[0])
                  }
                  if (parts[1]) {
                    if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                    assistantMessage.content += parts[1]
                    if (shouldStreamFinal) {
                      callbacks?.onFinalChunk(parts[1])
                    }
                  }
                } else {
                  assistantMessage.reasoning_content += contentChunk
                  callbacks?.onReasoning(contentChunk)
                }
              } else {
                if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                assistantMessage.content += contentChunk
                if (shouldStreamFinal) {
                  callbacks?.onFinalChunk(contentChunk)
                }
              }
            }
          } catch {
            // JSON parse error
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (assistantMessage.tool_calls) {
    assistantMessage.tool_calls = assistantMessage.tool_calls.filter(
      (tc) => tc && tc.function?.name
    )
  }

  if (!shouldStreamFinal) {
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (typeof assistantMessage.content === 'string' && assistantMessage.content) {
        callbacks?.onFinalChunk(assistantMessage.content)
      }
    }
  }

  return assistantMessage
}
