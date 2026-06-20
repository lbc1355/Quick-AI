import { ChatCompletionMessage, ChatToolDeclaration, PromptCacheStats } from '../../shared/types'
import { callModel, CallModelOptions, getPromptCacheStats } from './callModel'
import { RunUsageTracker } from './runUsageTracker'

export interface RunModelTurnOptions {
  modelConfig: CallModelOptions
  messages: ChatCompletionMessage[]
  toolsToDeclare?: ChatToolDeclaration[]
  signal?: AbortSignal
  usageTracker: Pick<RunUsageTracker, 'recordModelResponse'>
  onReasoning: (content: string) => void
  onContentChunk: (content: string) => void
  callModel?: typeof callModel
  getPromptCacheStats?: (message: ChatCompletionMessage) => PromptCacheStats | undefined
  now?: () => number
}

export interface RunModelTurnResult {
  assistantMessage: ChatCompletionMessage
  streamedText: string
}

export async function runModelTurn(options: RunModelTurnOptions): Promise<RunModelTurnResult> {
  const callModelFn = options.callModel || callModel
  const getStats = options.getPromptCacheStats || getPromptCacheStats
  const now = options.now || Date.now
  let streamedText = ''
  const modelStartTime = now()

  const assistantMessage = await callModelFn(
    options.modelConfig,
    options.messages,
    options.toolsToDeclare,
    options.signal,
    {
      onReasoning: options.onReasoning,
      onFinalChunk: (content) => {
        streamedText += content
        options.onContentChunk(content)
      }
    }
  )

  options.usageTracker.recordModelResponse(
    assistantMessage,
    now() - modelStartTime,
    getStats(assistantMessage)
  )

  return {
    assistantMessage,
    streamedText
  }
}
