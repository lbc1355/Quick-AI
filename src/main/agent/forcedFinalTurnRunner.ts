import { ChatCompletionMessage } from '../../shared/types'
import {
  DEFAULT_RESPONSE_RESERVE_RATIO,
  trimMessagesToFit as defaultTrimMessagesToFit
} from './contextManager'
import { CallModelOptions } from './callModel'
import { RunUsageTracker } from './runUsageTracker'
import { runModelTurn as defaultRunModelTurn } from './modelTurnRunner'
import { getMessageText as getAssistantText } from './messageText'
import type { ForcedFinalReason } from './agentRunLimits'

export interface RunForcedFinalTurnDependencies {
  trimMessagesToFit?: typeof defaultTrimMessagesToFit
  runModelTurn?: typeof defaultRunModelTurn
}

export interface RunForcedFinalTurnOptions {
  messages: ChatCompletionMessage[]
  reason: ForcedFinalReason
  signal: AbortSignal
  modelConfig: CallModelOptions
  contextSize: number
  usageTracker: Pick<RunUsageTracker, 'recordModelResponse'>
  emitReasoning: (content: string) => void
  emitFinal: (content: string) => void
  dependencies?: RunForcedFinalTurnDependencies
}

export interface RunForcedFinalTurnResult {
  messages: ChatCompletionMessage[]
  finalMessage: ChatCompletionMessage
}

export async function runForcedFinalTurn(
  options: RunForcedFinalTurnOptions
): Promise<RunForcedFinalTurnResult> {
  const trimMessagesToFit = options.dependencies?.trimMessagesToFit || defaultTrimMessagesToFit
  const runModelTurn = options.dependencies?.runModelTurn || defaultRunModelTurn
  const messagesWithPrompt = [
    ...options.messages,
    {
      role: 'user' as const,
      content:
        options.reason === 'loop_guard'
          ? 'Tool execution was halted after repeated consecutive failures. Please provide the best final answer you can based only on the observations available.'
          : options.reason === 'safety_limit'
            ? 'The emergency safety limit for this agent run has been reached. Please provide the best final answer you can based only on the observations available.'
            : 'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
    }
  ]

  if (options.signal.aborted) {
    throw new Error('Agent execution aborted by user.')
  }

  const messages = trimMessagesToFit(messagesWithPrompt, {
    maxTokens: options.contextSize,
    reserveForResponseRatio: DEFAULT_RESPONSE_RESERVE_RATIO,
    strategy: 'truncate-oldest-tool'
  })

  let finalEmitted = false
  const { assistantMessage: finalMessage } = await runModelTurn({
    modelConfig: options.modelConfig,
    messages,
    signal: options.signal,
    usageTracker: options.usageTracker,
    onReasoning: options.emitReasoning,
    onContentChunk: (content) => {
      finalEmitted = true
      options.emitFinal(content)
    }
  })

  const finalText = getAssistantText(finalMessage.content)
  if (!finalEmitted && finalText) {
    options.emitFinal(finalText)
  }

  return {
    messages,
    finalMessage
  }
}
