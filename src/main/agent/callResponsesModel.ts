import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'
import { DEFAULT_RETRY_POLICY, isRetryableError } from './retryPolicy'
import { ModelEventAccumulator, ModelEvent } from './modelEvents'
import { buildOpenAICompatibleRequestTarget } from './modelRequestTarget'
import type { CallModelCallbacks, CallModelOptions } from './modelCallTypes'
import {
  canUseTools,
  extractPromptCacheStats,
  getRequestModelId,
  promptCacheStatsByMessage,
  resolveModelAdapter,
  resolveModelConnection
} from './modelCallRuntime'
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
  const target = buildOpenAICompatibleRequestTarget(resolveModelConnection(options), 'responses')

  // 1. Convert messages & tools to Responses format
  const sanitizedMessages = adapter.sanitizeMessages(messages)
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

    const events = new ModelEventAccumulator(callbacks)
    const itemIdToIndex = new Map<string, number>()
    const emit = (event: Exclude<ModelEvent, { type: 'finish' }>): void => {
      if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
        streamingStarted = true
      }
      events.consume(event)
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
                  emit({ type: 'text-delta', delta: text })
                }
              } else if (type === 'response.reasoning_summary_text.delta') {
                const text = json.delta
                if (text) {
                  emit({ type: 'reasoning-delta', delta: text })
                }
              } else if (
                type === 'response.function_call_arguments.delta' ||
                type === 'response.function_call.arguments.delta'
              ) {
                const itemId = json.item_id || json.call_id
                const delta = json.delta

                if (itemId && delta) {
                  let idx = itemIdToIndex.get(itemId)
                  const isNew = idx === undefined
                  if (idx === undefined) {
                    idx = itemIdToIndex.size
                    itemIdToIndex.set(itemId, idx)
                  }
                  emit({
                    type: 'tool-call-delta',
                    index: idx,
                    id: json.call_id || (isNew ? itemId : undefined),
                    name: json.name,
                    argumentsDelta: delta
                  })
                }
              } else if (type === 'response.function_call_arguments.done') {
                const itemId = json.item_id
                const finalArguments = json.arguments
                if (itemId && finalArguments !== undefined) {
                  const idx = itemIdToIndex.get(itemId)
                  if (idx !== undefined) {
                    emit({
                      type: 'tool-call-delta',
                      index: idx,
                      arguments: finalArguments,
                      complete: true
                    })
                  }
                }
              } else if (type === 'response.output_item.added') {
                const item = json.item
                if (item && item.type === 'function_call') {
                  const itemId = item.id // fc_xxx
                  const callId = item.call_id || itemId // call_xxx (use as true tool_call_id)
                  const name = item.name
                  if (itemId && callId) {
                    const idx = itemIdToIndex.get(itemId) ?? itemIdToIndex.size
                    itemIdToIndex.set(itemId, idx)
                    emit({ type: 'tool-call-delta', index: idx, id: callId, name })
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
                  const idx = itemIdToIndex.get(itemId) ?? itemIdToIndex.size
                  itemIdToIndex.set(itemId, idx)
                  emit({ type: 'tool-call-delta', index: idx, id: callId, name })
                }
              } else if (type === 'response.completed' || type === 'response.done') {
                const usageStats = extractPromptCacheStats(json.response?.usage)
                if (usageStats) emit({ type: 'usage', usage: usageStats })
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

    const assistantMessage = events.finalize()
    if (events.usage) promptCacheStatsByMessage.set(assistantMessage, events.usage)
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
