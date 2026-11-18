import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'
import { DEFAULT_RETRY_POLICY, withRetry } from './retryPolicy'
import { ModelEventAccumulator, ModelEvent } from './modelEvents'
import { buildOpenAICompatibleRequestTarget } from './modelRequestTarget'
import type { CallModelCallbacks, CallModelOptions } from './modelCallTypes'
import {
  canUseTools,
  extractPromptCacheStats,
  getRequestModelId,
  promptCacheStatsByMessage,
  resolveModelAdapter,
  resolveModelConnection,
  resolveTransportId
} from './modelCallRuntime'
import {
  applyReasoningRequest,
  isUnsupportedReasoningParameterError,
  REASONING_UNSUPPORTED_USER_MESSAGE
} from './reasoningRequestPolicy'
import { chatMessagesToResponsesInput, chatToolsToResponsesTools } from './responsesAdapter'
import { applyModelRequestBodyOverrides } from './requestBodyOverrides'
import { ModelStreamScope } from './modelStreamLifecycle'
import { createHttpModelTransportError } from './modelTransportError'
import { serializeModelRequest } from './serializeModelRequest'
import { createModelTimingReporter } from './modelTiming'

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
  const timings = createModelTimingReporter(callbacks?.onTiming)
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

  body = applyModelRequestBodyOverrides(
    body,
    options.modelRuntime?.providerType === 'custom'
      ? options.modelRuntime.requestBodyOverrides
      : undefined
  )

  body = applyReasoningRequest({
    body,
    transportId: resolveTransportId(options),
    control: options.modelRuntime?.reasoningControl,
    requested: options.reasoningPreference || 'auto',
    outputTokenLimit: options.modelRuntime?.outputTokenLimit
  }).body

  body = adapter.sanitizeBody(body)
  const serializedBody = serializeModelRequest(body)

  let streamingStarted = false

  const attempt = async (): Promise<ChatCompletionMessage> => {
    const streamScope = new ModelStreamScope(adapter.streamPolicy, signal)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const timing = timings.startAttempt()

    try {
      const response = await streamScope.waitFor(
        () =>
          fetch(target.url, {
            method: 'POST',
            headers: target.headers,
            body: serializedBody,
            signal: streamScope.signal
          }),
        'Provider response'
      )

      timing.headers(response.status)
      if (!response.ok) {
        const errorText = await streamScope.waitFor(
          () => response.text(),
          'Provider error response'
        )
        const detail = errorText || response.statusText
        const message = isUnsupportedReasoningParameterError(detail)
          ? `${REASONING_UNSUPPORTED_USER_MESSAGE} (${response.status}: ${detail})`
          : undefined
        throw createHttpModelTransportError(response, detail, message)
      }

      reader = response.body?.getReader()
      if (!reader) throw new Error('Failed to get readable stream reader')

      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let explicitlyCompleted = false
      let stopReading = false

      const events = new ModelEventAccumulator(callbacks)
      const itemIdToIndex = new Map<string, number>()
      const emit = (event: Exclude<ModelEvent, { type: 'finish' }>): void => {
        if (event.type === 'text-delta' && event.delta) timing.output('text')
        if (event.type === 'reasoning-delta' && event.delta) timing.output('reasoning')
        if (event.type === 'tool-call-delta') timing.output('tool-call')
        if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
          streamingStarted = true
        }
        events.consume(event)
      }

      let currentEvent = ''

      while (true) {
        const { done, value } = await streamScope.waitFor(() => reader!.read(), 'Provider stream')
        if (done) break
        if (value?.byteLength) timing.bodyChunk()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleanLine = line.trim()
          if (!cleanLine) continue
          if (cleanLine === 'data: [DONE]') {
            explicitlyCompleted = true
            stopReading = true
            break
          }

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
                explicitlyCompleted = true
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
        if (stopReading) break
      }

      if (stopReading) {
        try {
          await reader.cancel()
        } catch {
          // The explicit completion marker is authoritative even if body cancellation races EOF.
        }
      }

      streamScope.assertCompleted(explicitlyCompleted, 'Responses API')

      const assistantMessage = events.finalize()
      if (events.usage) promptCacheStatsByMessage.set(assistantMessage, events.usage)
      timing.complete('success')
      return assistantMessage
    } catch (error) {
      timing.complete('error')
      if (reader) {
        try {
          await reader.cancel(error)
        } catch {
          // The provider may already have closed or aborted the body.
        }
      }
      throw error
    } finally {
      reader?.releaseLock()
      streamScope.dispose()
    }
  }

  // Retry transient failures only while nothing has streamed yet — once the first chunk reaches
  // the user, retrying would re-deliver already-visible output.
  return withRetry(attempt, DEFAULT_RETRY_POLICY, signal, () => !streamingStarted)
}
