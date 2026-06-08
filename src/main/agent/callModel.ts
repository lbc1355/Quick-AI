import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'
import { DEFAULT_RETRY_POLICY, isRetryableError } from './retryPolicy'

export interface CallModelOptions {
  apiUrl: string
  apiKey: string
  model: string
}

export interface CallModelCallbacks {
  onReasoning: (content: string) => void
  onFinalChunk: (content: string) => void
}

export function prepareMessagesForModel(
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] {
  return messages.map((m) => {
    if (m.role !== 'assistant') return m

    const copy = { ...m }
    if (!copy.reasoning_content) {
      delete copy.reasoning_content
    }
    return copy
  })
}

export async function callModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  const body: Record<string, unknown> = {
    model: options.model,
    messages: prepareMessagesForModel(messages),
    stream: true
  }

  if (toolsToDeclare && toolsToDeclare.length > 0) {
    body.tools = toolsToDeclare
    body.tool_choice = 'auto'
  }

  const shouldStreamFinal = true

  // Tracks whether any user-visible chunk (reasoning/final) has been emitted. Once true,
  // the request must NOT be retried — retrying would duplicate streamed output to the UI.
  // Tool-call deltas have no visible side effect, so they don't block a retry.
  let streamingStarted = false

  // A single network attempt: open the SSE stream, parse it, and accumulate the message.
  const attempt = async (): Promise<ChatCompletionMessage> => {
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

    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: '',
      reasoning_content: '',
      tool_calls: []
    }

    let inThinkTag = false

    const emitReasoning = (content: string): void => {
      streamingStarted = true
      callbacks?.onReasoning(content)
    }
    const emitFinal = (content: string): void => {
      streamingStarted = true
      callbacks?.onFinalChunk(content)
    }

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
                emitReasoning(delta.reasoning_content)
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
                    assistantMessage.tool_calls[idx].function.arguments +=
                      tcDelta.function.arguments
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
                      emitFinal(parts[0])
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
                      emitReasoning(parts[0])
                    }
                    if (parts[1]) {
                      if (typeof assistantMessage.content !== 'string')
                        assistantMessage.content = ''
                      assistantMessage.content += parts[1]
                      if (shouldStreamFinal) {
                        emitFinal(parts[1])
                      }
                    }
                  } else {
                    assistantMessage.reasoning_content += contentChunk
                    emitReasoning(contentChunk)
                  }
                } else {
                  if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                  assistantMessage.content += contentChunk
                  if (shouldStreamFinal) {
                    emitFinal(contentChunk)
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
          emitFinal(assistantMessage.content)
        }
      }
    }

    return assistantMessage
  }

  // Retry only transient failures that occur before any user-visible output has streamed.
  // Once streamingStarted flips true, a failure is surfaced immediately to avoid duplicating
  // partially-streamed reasoning/answer text on a re-attempt.
  let lastError: Error | undefined
  for (let attemptNo = 0; attemptNo <= DEFAULT_RETRY_POLICY.maxRetries; attemptNo++) {
    try {
      if (signal?.aborted) throw new Error('Agent execution aborted by user.')
      return await attempt()
    } catch (error) {
      lastError = error as Error
      const canRetry =
        !streamingStarted &&
        attemptNo < DEFAULT_RETRY_POLICY.maxRetries &&
        isRetryableError(lastError, DEFAULT_RETRY_POLICY) &&
        !signal?.aborted

      if (!canRetry) throw lastError

      const delay = Math.min(
        DEFAULT_RETRY_POLICY.baseDelayMs * Math.pow(2, attemptNo),
        DEFAULT_RETRY_POLICY.maxDelayMs
      )
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timeoutId)
          signal?.removeEventListener('abort', onAbort)
          reject(new Error('Agent execution aborted by user.'))
        }
        if (signal?.aborted) {
          return reject(new Error('Agent execution aborted by user.'))
        }
        const timeoutId = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, delay)
        signal?.addEventListener('abort', onAbort)
      })
    }
  }

  throw lastError || new Error('callModel failed')
}
