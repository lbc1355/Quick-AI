import {
  ChatCompletionMessage,
  ChatToolDeclaration,
  PromptCacheStats
} from '../../shared/types'
import { DEFAULT_RETRY_POLICY, isRetryableError } from './retryPolicy'
import {
  CallModelCallbacks,
  CallModelOptions,
  canUseTools,
  countGeneratedArgumentLines,
  extractPromptCacheStats,
  getRequestModelId,
  prepareMessagesForModel,
  promptCacheStatsByMessage,
  resolveModelAdapter,
  TOOL_CALL_PROGRESS_CHAR_INTERVAL,
  TOOL_CALL_PROGRESS_LINE_INTERVAL
} from './callModel'

export async function callChatCompletionsModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`
  const adapter = resolveModelAdapter(options)

  const sanitizedMessages = adapter.sanitizeMessages(prepareMessagesForModel(messages))

  let body: Record<string, unknown> = {
    model: getRequestModelId(options),
    messages: sanitizedMessages,
    stream: true
  }

  if (adapter.supportsStreamUsage) {
    body.stream_options = { include_usage: true }
  }

  if (toolsToDeclare && toolsToDeclare.length > 0 && canUseTools(options)) {
    body.tools = toolsToDeclare
    body.tool_choice = 'auto'
  }

  body = adapter.sanitizeBody(body)

  const shouldStreamFinal = true
  let streamingStarted = false

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
    let promptCacheStats: PromptCacheStats | undefined
    const toolCallProgress = new Map<
      number,
      {
        emittedStart: boolean
        lastEmittedArgumentsLength: number
        lastEmittedLineCount: number
        lastToolName?: string
      }
    >()

    const emitReasoning = (content: string): void => {
      streamingStarted = true
      callbacks?.onReasoning(content)
    }
    const emitFinal = (content: string): void => {
      streamingStarted = true
      callbacks?.onFinalChunk(content)
    }
    const emitToolCallProgress = (
      index: number,
      toolCall: NonNullable<ChatCompletionMessage['tool_calls']>[number],
      argumentsDeltaLength: number,
      force = false
    ): void => {
      if (!callbacks?.onToolCallProgress) return

      const toolName = toolCall.function.name || undefined
      if (!toolName && !toolCall.id) return

      const state = toolCallProgress.get(index) || {
        emittedStart: false,
        lastEmittedArgumentsLength: 0,
        lastEmittedLineCount: 0,
        lastToolName: undefined
      }
      const argumentsLength = toolCall.function.arguments.length
      const generatedLineCount = countGeneratedArgumentLines(toolName, toolCall.function.arguments)
      const shouldEmitStart = !state.emittedStart
      const shouldEmitToolName = Boolean(toolName && toolName !== state.lastToolName)
      const shouldEmitArguments =
        argumentsLength - state.lastEmittedArgumentsLength >= TOOL_CALL_PROGRESS_CHAR_INTERVAL
      const shouldEmitLines =
        generatedLineCount > 0 &&
        (state.lastEmittedLineCount === 0 ||
          generatedLineCount - state.lastEmittedLineCount >= TOOL_CALL_PROGRESS_LINE_INTERVAL)
      const shouldEmitFinal =
        force &&
        (argumentsLength !== state.lastEmittedArgumentsLength ||
          generatedLineCount !== state.lastEmittedLineCount ||
          toolName !== state.lastToolName)

      if (
        !shouldEmitStart &&
        !shouldEmitToolName &&
        !shouldEmitArguments &&
        !shouldEmitLines &&
        !shouldEmitFinal
      ) {
        return
      }

      callbacks.onToolCallProgress({
        index,
        id: toolCall.id || undefined,
        toolName,
        argumentsLength,
        argumentsDeltaLength,
        generatedLineCount
      })
      toolCallProgress.set(index, {
        emittedStart: true,
        lastEmittedArgumentsLength: argumentsLength,
        lastEmittedLineCount: generatedLineCount,
        lastToolName: toolName
      })
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
              const usageStats = extractPromptCacheStats(json.usage)
              if (usageStats) {
                promptCacheStats = usageStats
              }
              const delta = json.choices?.[0]?.delta
              if (!delta) continue

              if (delta.reasoning_content) {
                assistantMessage.reasoning_content += delta.reasoning_content
                emitReasoning(delta.reasoning_content)
              }

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
                  emitToolCallProgress(
                    idx,
                    assistantMessage.tool_calls[idx],
                    tcDelta.function?.arguments?.length || 0
                  )
                }
              }

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

    assistantMessage.tool_calls?.forEach((toolCall, index) => {
      if (toolCall) {
        emitToolCallProgress(index, toolCall, 0, true)
      }
    })

    if (assistantMessage.tool_calls) {
      assistantMessage.tool_calls = assistantMessage.tool_calls.filter(
        (tc) => tc && tc.function?.name
      )
      if (assistantMessage.tool_calls.length === 0) {
        delete assistantMessage.tool_calls
      }
    }

    if (!shouldStreamFinal) {
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        if (typeof assistantMessage.content === 'string' && assistantMessage.content) {
          emitFinal(assistantMessage.content)
        }
      }
    }

    if (promptCacheStats) {
      promptCacheStatsByMessage.set(assistantMessage, promptCacheStats)
    }

    return assistantMessage
  }

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

  throw lastError || new Error('callChatCompletionsModel failed')
}
