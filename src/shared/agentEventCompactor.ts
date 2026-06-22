import { AgentEvent } from './types'
import { mergeAgentEvents } from './agentEventReducer'

export interface CompactAgentEventsOptions {
  /**
   * Progress events are UI state refreshes. For durable history, keep only the
   * latest progress event for each step by default.
   */
  progress?: 'latest-per-step' | 'all' | 'drop'
}

const getProgressKey = (event: Extract<AgentEvent, { type: 'agent_progress' }>): string =>
  event.stepId || String(event.step)

const appendLatestProgress = (
  compacted: AgentEvent[],
  event: Extract<AgentEvent, { type: 'agent_progress' }>
): AgentEvent[] => {
  const key = getProgressKey(event)
  return [...compacted.filter((existing) => {
    if (existing.type !== 'agent_progress') return true
    return getProgressKey(existing) !== key
  }), event]
}

export function compactAgentEvents(
  events: AgentEvent[] | undefined,
  options: CompactAgentEventsOptions = {}
): AgentEvent[] {
  if (!events || events.length === 0) return []

  const progressMode = options.progress || 'latest-per-step'
  let compacted: AgentEvent[] = []

  for (const event of events) {
    if (event.type === 'agent_progress') {
      if (progressMode === 'drop') continue
      if (progressMode === 'latest-per-step') {
        compacted = appendLatestProgress(compacted, event)
      } else {
        compacted = mergeAgentEvents(compacted, event)
      }
      continue
    }

    compacted = mergeAgentEvents(compacted, event)
  }

  return compacted
}
