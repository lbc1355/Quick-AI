import { AgentEvent } from '../../shared/types'

export interface AgentEventStreamOptions {
  runId: string
  emit: (event: AgentEvent) => void
  now?: () => number
}

export interface AgentEventStream {
  emit: (event: AgentEvent) => AgentEvent
  getSequence: () => number
}

export function createAgentEventStream(options: AgentEventStreamOptions): AgentEventStream {
  const now = options.now || Date.now
  let sequence = 0

  return {
    emit: (event) => {
      sequence += 1
      const normalized: AgentEvent = {
        ...event,
        runId: event.runId || options.runId,
        sequence: event.sequence ?? sequence,
        timestamp: event.timestamp ?? now()
      }
      options.emit(normalized)
      return normalized
    },
    getSequence: () => sequence
  }
}
