import { ChatCompletionMessage, ChatToolDeclaration, PromptCacheStats } from '../../shared/types'
import { DEFAULT_RETRY_POLICY, isRetryableError } from './retryPolicy'
import { promoteReasoningOnlyFinalAnswer } from './modelResponseNormalizer'
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
import { chatMessagesToResponsesInput, chatToolsToResponsesTools } from './responsesAdapter'

interface FatalMarkedError extends Error {
  isFatal?: boolean
}

export async function callResponsesModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const adapter = resolveModelAdapter(options)
  const target = adapter.buildRequestTarget({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    apiFormat: 'responses'
  })

  // 1. Convert messages & tools to Responses format
  const sanitizedMessages = adapter.sanitizeMessages(prepareMessagesForModel(messages))
  const { instructions, input } = chatMessagesToResponsesInput(sanitizedMessages)
  let body: Record<string, unknown> = {
    model: getRequestModelId(options),
    input,
    stream: true,
    store: false // Explicitly disable server-side state in v1
  }

  if (instructions) {
    body.instructions = instructions
  }

  if (toolsToDeclare && toolsToDeclare.length > 0 && canUseTools(options)) {
    body.tools = chatToolsToResponsesTools(toolsToDeclare)
    body.tool_choice = 'auto'
  }

  body = adapter.sanitizeBody(body)

  let streamingStarted = false

  const attempt = async (): Promise<ChatCompletionMessage> => {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
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

    let promptCacheStats: PromptCacheStats | undefined
    const itemIdToIndex = new Map<string, number>()
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

    let currentEvent = ''

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

          if (cleanLine.startsWith('event: ')) {
            currentEvent = cleanLine.substring(7).trim()
            continue
          }

          if (cleanLine.startsWith('data: ')) {
            try {
              const dataText = cleanLine.substring(6)
              const json = JSON.parse(dataText)
              const type = currentEvent || json.type

              if (type === 'response.output_text.delta') {
                const text = json.delta
                if (text) {
                  if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                  assistantMessage.content += text
                  emitFinal(text)
                }
              } else if (type === 'response.reasoning_summary_text.delta') {
                const text = json.delta
                if (text) {
                  assistantMessage.reasoning_content += text
                  emitReasoning(text)
                }
              } else if (
                type === 'response.function_call_arguments.delta' ||
                type === 'response.function_call.arguments.delta'
              ) {
                const itemId = json.item_id || json.call_id
                const delta = json.delta

                if (itemId && delta) {
                  let idx = itemIdToIndex.get(itemId)
                  if (idx === undefined) {
                    if (!assistantMessage.tool_calls) assistantMessage.tool_calls = []
                    idx = assistantMessage.tool_calls.length
                    assistantMessage.tool_calls.push({
                      id: itemId, // fallback to itemId if added event wasn't sent first
                      type: 'function',
                      function: { name: json.name || '', arguments: '' }
                    })
                    itemIdToIndex.set(itemId, idx)
                  }

                  const toolCalls = assistantMessage.tool_calls
                  if (toolCalls && toolCalls[idx]) {
                    toolCalls[idx].function.arguments += delta
                    emitToolCallProgress(idx, toolCalls[idx], delta.length)
                  }
                }
              } else if (type === 'response.function_call_arguments.done') {
                const itemId = json.item_id
                const finalArguments = json.arguments
                if (itemId && finalArguments !== undefined) {
                  const idx = itemIdToIndex.get(itemId)
                  const toolCalls = assistantMessage.tool_calls
                  if (idx !== undefined && toolCalls && toolCalls[idx]) {
                    toolCalls[idx].function.arguments = finalArguments
                    emitToolCallProgress(idx, toolCalls[idx], 0, true)
                  }
                }
              } else if (type === 'response.output_item.added') {
                const item = json.item
                if (item && item.type === 'function_call') {
                  const itemId = item.id // fc_xxx
                  const callId = item.call_id || itemId // call_xxx (use as true tool_call_id)
                  const name = item.name
                  if (itemId && callId) {
                    if (!assistantMessage.tool_calls) assistantMessage.tool_calls = []
                    let idx = assistantMessage.tool_calls.findIndex((tc) => tc.id === callId)
                    if (idx === -1) {
                      idx = assistantMessage.tool_calls.length
                      assistantMessage.tool_calls.push({
                        id: callId,
                        type: 'function',
                        function: { name: name || '', arguments: '' }
                      })
                    } else {
                      if (name) assistantMessage.tool_calls[idx].function.name = name
                    }
                    itemIdToIndex.set(itemId, idx)
                    emitToolCallProgress(idx, assistantMessage.tool_calls[idx], 0)
                  }
                }
              } else if (
                type === 'response.function_call.created' ||
                type === 'response.function_call_arguments.created'
              ) {
                const itemId = json.item_id || json.call_id
                const callId = json.call_id || itemId
                const name = json.name
                if (itemId && callId) {
                  if (!assistantMessage.tool_calls) assistantMessage.tool_calls = []
                  let idx = assistantMessage.tool_calls.findIndex((tc) => tc.id === callId)
                  if (idx === -1) {
                    idx = assistantMessage.tool_calls.length
                    assistantMessage.tool_calls.push({
                      id: callId,
                      type: 'function',
                      function: { name: name || '', arguments: '' }
                    })
                  }
                  itemIdToIndex.set(itemId, idx)
                  emitToolCallProgress(idx, assistantMessage.tool_calls[idx], 0)
                }
              } else if (type === 'response.completed' || type === 'response.done') {
                const usageStats = extractPromptCacheStats(json.response?.usage)
                if (usageStats) {
                  promptCacheStats = usageStats
                }
              } else if (type === 'response.failed' || type === 'error') {
                const errMsg =
                  json.error?.message ||
                  json.response?.error?.message ||
                  json.response?.status_details?.error?.message ||
                  'Responses API failed'
                const err = new Error(errMsg) as FatalMarkedError
                err.isFatal = true
                throw err
              }
            } catch (e) {
              if (e instanceof Error && (e as FatalMarkedError).isFatal) {
                throw e
              }
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

    const promotedFinalAnswer = promoteReasoningOnlyFinalAnswer(assistantMessage)
    if (promotedFinalAnswer) {
      emitFinal(promotedFinalAnswer)
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

  throw lastError || new Error('callResponsesModel failed')
}
