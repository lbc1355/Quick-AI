import { AgentEvent, Message } from './types'
import { applyAgentEventToMessage } from './agentEventReducer'

export interface ReplayAgentEventsOptions {
  message?: Partial<Message>
}

export function createReplayBaseMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || 'replay',
    role: overrides.role || 'assistant',
    content: overrides.content || '',
    reasoning_content: overrides.reasoning_content,
    files: overrides.files,
    agentRunId: overrides.agentRunId,
    agentRunIds: overrides.agentRunIds,
    agentEvents: overrides.agentEvents ? [...overrides.agentEvents] : [],
    isRuntimeError: overrides.isRuntimeError,
    isBranchFork: overrides.isBranchFork,
    forkedFrom: overrides.forkedFrom,
    tokenSpeed: overrides.tokenSpeed,
    cacheStats: overrides.cacheStats
  }
}

export function replayAgentEvents(
  events: AgentEvent[] | undefined,
  options: ReplayAgentEventsOptions = {}
): Message {
  const baseMessage = createReplayBaseMessage(options.message)
  return (events || []).reduce(
    (message, event) => applyAgentEventToMessage(message, event),
    baseMessage
  )
}
