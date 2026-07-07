import type {
  Message,
  ContextRetentionMode,
  CachePriorityRetainedRunRef
} from '../../../../shared/types'
import { isRuntimeErrorAssistantMessage } from '../../hooks/chatMessageEvents'
import { getMessagesForLLM } from './apiMessageBuilder'

export function getCachePriorityRetainedRuns(
  messages: Message[],
  contextRetentionMode: ContextRetentionMode,
  systemPrompt: string
): CachePriorityRetainedRunRef[] | undefined {
  if (contextRetentionMode !== 'cache-priority') return undefined

  const messagesToProcess = getMessagesForLLM(messages)

  let apiMessageIndex = systemPrompt ? 1 : 0
  const refs: CachePriorityRetainedRunRef[] = []
  const seen = new Set<string>()

  for (const message of messagesToProcess) {
    if (isRuntimeErrorAssistantMessage(message)) continue

    if (message.role === 'assistant') {
      const runIds = message.agentRunIds || (message.agentRunId ? [message.agentRunId] : [])
      for (const runId of runIds) {
        if (runId && !seen.has(runId)) {
          seen.add(runId)
          refs.push({ runId, assistantMessageIndex: apiMessageIndex })
        }
      }
    }

    apiMessageIndex++
  }

  return refs.length > 0 ? refs : undefined
}

export function computeRemovedRunIds(messages: Message[], afterIndex: number): string[] {
  return messages
    .slice(afterIndex + 1)
    .filter((m) => m.role === 'assistant' && m.agentRunId)
    .map((m) => m.agentRunId as string)
}
