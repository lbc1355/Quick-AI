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
  resolveModelFeatures,
  resolveTransportId
} from './modelCallRuntime'
import {
  applyReasoningRequest,
  isUnsupportedReasoningParameterError,
  REASONING_UNSUPPORTED_USER_MESSAGE
} from './reasoningRequestPolicy'
import { applyModelRequestBodyOverrides } from './requestBodyOverrides'
import { ClosingThinkTagSplitter } from './closingThinkTagSplitter'
import { ModelStreamScope } from './modelStreamLifecycle'
import { createHttpModelTransportError } from './modelTransportError'

export async function callChatCompletionsModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const adapter = resolveModelAdapter(options)
  const features = resolveModelFeatures(options, adapter)
  const transportId = resolveTransportId(options)
  const target = buildOpenAICompatibleRequestTarget(
    resolveModelConnection(options),
    'chat/completions'
  )

  const sanitizedMessages = adapter.sanitizeMessages(messages)

  let body: Record<string, unknown> = {
    model: getRequestModelId(options),
    messages: sanitizedMessages,
    stream: true
  }

  if (features.streamUsage) {
    body.stream_options = { include_usage: true }
  }

  if (toolsToDeclare && toolsToDeclare.length > 0 && canUseTools(options)) {
    body.tools = toolsToDeclare
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
    transportId,
    control: options.modelRuntime?.reasoningControl,
    requested: options.reasoningPreference || 'auto',
    outputTokenLimit: options.modelRuntime?.outputTokenLimit
  }).body

  body = adapter.sanitizeBody(body)

  const shouldStreamFinal = true
  let streamingStarted = false

  const attempt = async (): Promise<ChatCompletionMessage> => {
    const streamScope = new ModelStreamScope(adapter.streamPolicy, signal)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const response = await streamScope.waitFor(
        () =>
          fetch(target.url, {
            method: 'POST',
            headers: target.headers,
            body: JSON.stringify(body),
            signal: streamScope.signal
          }),
        'Provider response'
      )

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
      let inThinkTag = false
      let sawStructuredReasoning = false
      const closingThinkSplitter =
        adapter.compatibility.reasoningResponseFormat === 'closing-think-tag'
          ? new ClosingThinkTagSplitter()
          : undefined
      const emit = (event: Exclude<ModelEvent, { type: 'finish' }>): void => {
        if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
          streamingStarted = true
        }
        events.consume(event)
      }
      const emitClosingThinkSplit = (split: { reasoning?: string; content?: string }): void => {
        if (split.reasoning) emit({ type: 'reasoning-delta', delta: split.reasoning })
        if (split.content && shouldStreamFinal) emit({ type: 'text-delta', delta: split.content })
      }

      while (true) {
        const { done, value } = await streamScope.waitFor(() => reader!.read(), 'Provider stream')
        if (done) break

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

          if (cleanLine.startsWith('data: ')) {
            try {
              const json = JSON.parse(cleanLine.substring(6))
              const usageStats = extractPromptCacheStats(json.usage)
              if (usageStats) emit({ type: 'usage', usage: usageStats })
              const delta = json.choices?.[0]?.delta
              if (!delta) continue

              if (delta.reasoning_content) {
                sawStructuredReasoning = true
                emit({ type: 'reasoning-delta', delta: delta.reasoning_content })
              }

              if (delta.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                  const idx = tcDelta.index
                  emit({
                    type: 'tool-call-delta',
                    index: idx,
                    id: tcDelta.id,
                    name: tcDelta.function?.name,
                    argumentsDelta: tcDelta.function?.arguments
                  })
                }
              }

              if (delta.content) {
                let contentChunk = delta.content

                if (closingThinkSplitter && !sawStructuredReasoning) {
                  emitClosingThinkSplit(closingThinkSplitter.push(contentChunk))
                } else if (contentChunk.includes('<think>')) {
                  inThinkTag = true
                  const parts = contentChunk.split('<think>')
                  if (parts[0]) {
                    if (shouldStreamFinal) emit({ type: 'text-delta', delta: parts[0] })
                  }
                  contentChunk = parts.slice(1).join('<think>')
                }

                if (closingThinkSplitter && !sawStructuredReasoning) {
                  // The compatibility splitter emitted this chunk above.
                } else if (inThinkTag) {
                  if (contentChunk.includes('</think>')) {
                    inThinkTag = false
                    const parts = contentChunk.split('</think>')
                    if (parts[0]) {
                      emit({ type: 'reasoning-delta', delta: parts[0] })
                    }
                    if (parts[1]) {
                      if (shouldStreamFinal) emit({ type: 'text-delta', delta: parts[1] })
                    }
                  } else {
                    emit({ type: 'reasoning-delta', delta: contentChunk })
                  }
                } else {
                  if (shouldStreamFinal) emit({ type: 'text-delta', delta: contentChunk })
                }
              }
            } catch {
              // JSON parse error
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

      streamScope.assertCompleted(explicitlyCompleted, 'Chat Completions')

      if (closingThinkSplitter && !sawStructuredReasoning) {
        emitClosingThinkSplit(closingThinkSplitter.finish())
      }

      const assistantMessage = events.finalize()
      if (events.usage) promptCacheStatsByMessage.set(assistantMessage, events.usage)
      return assistantMessage
    } catch (error) {
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
