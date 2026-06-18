import { AgentEvent, Message, SessionResource } from '../../../shared/types'

const mergeResourceRanges = (
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> => {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const current = sorted[i]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push(current)
    }
  }

  return merged
}

export const mergeResourceUpdate = (
  existing: SessionResource | undefined,
  incoming: SessionResource,
  reqId: string
): SessionResource => {
  if (!existing) {
    return { ...incoming, runIds: [reqId] }
  }

  const chunkMap = new Map(existing.chunks.map((chunk) => [chunk.id, chunk]))
  incoming.chunks.forEach((chunk) => {
    chunkMap.set(chunk.id, chunk)
  })
  const newChunks = Array.from(chunkMap.values()).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))

  const fetchedRanges = mergeResourceRanges([
    ...(existing.fetchedRanges || []),
    ...(incoming.fetchedRanges || [])
  ])

  const runIds = Array.from(new Set([...(existing.runIds ?? []), reqId]))

  return {
    ...existing,
    title: incoming.title || existing.title,
    totalChars: incoming.totalChars ?? existing.totalChars,
    nextOffset: incoming.nextOffset,
    status: incoming.status,
    summary: incoming.summary ?? existing.summary,
    fetchedRanges,
    runIds,
    chunks: newChunks,
    updatedAt: incoming.updatedAt || Date.now()
  }
}

export const applyAgentEventToMessage = (m: Message, newEvent: AgentEvent): Message => {
  const currentEvents = m.agentEvents || []
  const updatedEvents = [...currentEvents]

  if (newEvent.type === 'tool_call') {
    const existingIdx = updatedEvents.findIndex(
      (e) => e.type === 'tool_call' && e.callId === newEvent.callId
    )
    if (existingIdx !== -1) {
      const existingEvent = updatedEvents[existingIdx]
      if (existingEvent.type === 'tool_call') {
        updatedEvents[existingIdx] = {
          ...existingEvent,
          permissionState: newEvent.permissionState,
          purpose: newEvent.purpose || existingEvent.purpose
        }
      }
    } else {
      updatedEvents.push(newEvent)
    }
  } else if (newEvent.type === 'tool_output_delta') {
    const lastEvent = updatedEvents[updatedEvents.length - 1]
    if (
      lastEvent?.type === 'tool_output_delta' &&
      lastEvent.callId === newEvent.callId &&
      lastEvent.stream === newEvent.stream
    ) {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: newEvent.replace ? newEvent.content : lastEvent.content + newEvent.content,
        replace: newEvent.replace || lastEvent.replace
      }
    } else {
      updatedEvents.push(newEvent)
    }
  } else if (newEvent.type === 'task_update') {
    // Replace any previous task_update so the list reflects the latest state.
    const withoutTasks: AgentEvent[] = updatedEvents.filter((e) => e.type !== 'task_update')
    withoutTasks.push(newEvent)
    return { ...m, agentEvents: withoutTasks }
  } else if (updatedEvents.length > 0) {
    const lastEvent = updatedEvents[updatedEvents.length - 1]
    if (lastEvent.type === 'reasoning' && newEvent.type === 'reasoning') {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: lastEvent.content + newEvent.content
      }
    } else if (
      lastEvent.type === 'agent_message_delta' &&
      newEvent.type === 'agent_message_delta' &&
      lastEvent.stepId === newEvent.stepId
    ) {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: lastEvent.content + newEvent.content
      }
    } else if (lastEvent.type === 'final' && newEvent.type === 'final') {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: lastEvent.content + newEvent.content
      }
    } else {
      updatedEvents.push(newEvent)
    }
  } else {
    updatedEvents.push(newEvent)
  }

  let newContent = m.content
  let newReasoning = m.reasoning_content

  if (newEvent.type === 'reasoning') {
    newReasoning = (newReasoning || '') + newEvent.content
  } else if (newEvent.type === 'final') {
    newContent = (newContent || '') + newEvent.content
  }

  return {
    ...m,
    agentEvents: updatedEvents,
    content: newContent,
    reasoning_content: newReasoning
  }
}

const RUNTIME_ERROR_PREFIXES = [
  '⚠️ 出错了：',
  '⚠️ 出错了:',
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
