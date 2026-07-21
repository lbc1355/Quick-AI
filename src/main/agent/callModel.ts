import type { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'
import { getModelTransport } from './modelTransport'
import { resolveTransportId } from './modelCallRuntime'
import type { CallModelCallbacks, CallModelOptions } from './modelCallTypes'

export type { CallModelCallbacks, CallModelOptions, ToolCallStreamProgress } from './modelCallTypes'
export type { ModelEvent } from './modelEvents'
export {
  countGeneratedArgumentLines,
  TOOL_CALL_PROGRESS_CHAR_INTERVAL,
  TOOL_CALL_PROGRESS_LINE_INTERVAL
} from './modelEvents'
export {
  canUseTools,
  extractPromptCacheStats,
  getPromptCacheStats,
  getRequestModelId,
  prepareMessagesForModel,
  promptCacheStatsByMessage,
  resolveApiFormat,
  resolveModelAdapter,
  resolveModelFeatures,
  resolveTransportId
} from './modelCallRuntime'

export async function callModel(
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
): Promise<ChatCompletionMessage> {
  const transport = getModelTransport(resolveTransportId(options))
  return transport.execute(options, messages, toolsToDeclare, signal, callbacks)
}
