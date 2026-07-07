import { AgentEvent, Message } from './types'

const withLatestEventMetadata = <T extends AgentEvent>(previous: T, incoming: AgentEvent): T => ({
  ...previous,
  runId: incoming.runId ?? previous.runId,
  sequence: incoming.sequence ?? previous.sequence,
  timestamp: incoming.timestamp ?? previous.timestamp
})

export function mergeAgentEvents(
  currentEvents: AgentEvent[] | undefined,
  newEvent: AgentEvent
): AgentEvent[] {
  const updatedEvents = [...(currentEvents || [])]

  if (newEvent.type === 'tool_call') {
    const existingIdx = updatedEvents.findIndex(
      (event) => event.type === 'tool_call' && event.callId === newEvent.callId
    )
    if (existingIdx !== -1) {
      const existingEvent = updatedEvents[existingIdx]
      if (existingEvent.type === 'tool_call') {
        updatedEvents[existingIdx] = {
          ...existingEvent,
          ...newEvent,
          purpose: newEvent.purpose || existingEvent.purpose
        }
      }
    } else {
      updatedEvents.push(newEvent)
    }
    return updatedEvents
  }

  if (newEvent.type === 'tool_output_delta') {
    const lastEvent = updatedEvents[updatedEvents.length - 1]
    if (
      lastEvent?.type === 'tool_output_delta' &&
      lastEvent.callId === newEvent.callId &&
      lastEvent.stream === newEvent.stream
    ) {
      updatedEvents[updatedEvents.length - 1] = {
        ...withLatestEventMetadata(lastEvent, newEvent),
        content: newEvent.replace ? newEvent.content : lastEvent.content + newEvent.content,
        replace: newEvent.replace || lastEvent.replace
      }
    } else {
      updatedEvents.push(newEvent)
    }
    return updatedEvents
  }

  if (newEvent.type === 'task_update') {
    return [...updatedEvents.filter((event) => event.type !== 'task_update'), newEvent]
  }

  const lastEvent = updatedEvents[updatedEvents.length - 1]
  if (!lastEvent) {
    updatedEvents.push(newEvent)
    return updatedEvents
  }

  if (lastEvent.type === 'reasoning' && newEvent.type === 'reasoning') {
    updatedEvents[updatedEvents.length - 1] = {
      ...withLatestEventMetadata(lastEvent, newEvent),
      content: lastEvent.content + newEvent.content
    }
  } else if (
    lastEvent.type === 'agent_message_delta' &&
    newEvent.type === 'agent_message_delta' &&
    lastEvent.stepId === newEvent.stepId
  ) {
    updatedEvents[updatedEvents.length - 1] = {
      ...withLatestEventMetadata(lastEvent, newEvent),
      content: lastEvent.content + newEvent.content
    }
  } else if (lastEvent.type === 'final' && newEvent.type === 'final') {
    updatedEvents[updatedEvents.length - 1] = {
      ...withLatestEventMetadata(lastEvent, newEvent),
      content: lastEvent.content + newEvent.content
    }
  } else {
    updatedEvents.push(newEvent)
  }

  return updatedEvents
}

export const applyAgentEventToMessage = (message: Message, newEvent: AgentEvent): Message => {
  let newContent = message.content
  let newReasoning = message.reasoning_content

  if (newEvent.type === 'reasoning') {
    newReasoning = (newReasoning || '') + newEvent.content
  } else if (newEvent.type === 'final') {
    newContent = (newContent || '') + newEvent.content
  }

  return {
    ...message,
    agentEvents: mergeAgentEvents(message.agentEvents, newEvent),
    content: newContent,
    reasoning_content: newReasoning
  }
}

const RUNTIME_ERROR_PREFIXES = [
  '\u26a0\ufe0f \u51fa\u9519\u4e86\uff1a',
  '\u26a0\ufe0f \u51fa\u9519\u4e86:',
  '\u51fa\u9519\u4e86\uff1a',
  '\u51fa\u9519\u4e86:',
  'Agent Skill failed:',
  'Agent resume failed:'
]

const isFailureAgentEnd = (
  event: AgentEvent
): event is Extract<AgentEvent, { type: 'agent_end' }> =>
  event.type === 'agent_end' && (event.status === 'failed' || event.status === 'cancelled')

const isRuntimeErrorFinal = (event: AgentEvent): boolean => {
  if (event.type !== 'final') return false
  const content = event.content.trim()
  return RUNTIME_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
}

export const prepareMessageForInlineResume = (msg: Message, nextRunId: string): Message => {
  const dropFinalEvents = isRuntimeErrorAssistantMessage(msg)
  const cleanedEvents = (msg.agentEvents || []).filter(
    (event) =>
      !isFailureAgentEnd(event) &&
      !isRuntimeErrorFinal(event) &&
      !(dropFinalEvents && event.type === 'final')
  )
  const agentRunIds = Array.from(
    new Set([...(msg.agentRunIds || []), msg.agentRunId, nextRunId].filter(Boolean) as string[])
  )

  return {
    ...msg,
    content: '',
    reasoning_content: '',
    agentRunId: nextRunId,
    agentRunIds,
    agentEvents: cleanedEvents,
    isRuntimeError: undefined
  }
}

export const isRuntimeErrorAssistantMessage = (msg: Message): boolean => {
  if (msg.role !== 'assistant') return false
  if (msg.isRuntimeError) return true
  const content = (msg.content || '').trim()
  return RUNTIME_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
}
