import type { Message, RunMode, Session } from '../../../../shared/types'

export interface PreparedClaimedPromptRun {
  session: Session
  assistantMessageId: string
  messagesBeforeAssistant: Message[]
}

export function appendQueuedPromptToSession(
  session: Session,
  userMessage: Message,
  assistantPlaceholder: Message
): Session {
  return {
    ...session,
    messages: [...session.messages, userMessage, assistantPlaceholder],
    lastActiveTime: Date.now()
  }
}

/** Move an accepted steer immediately before the assistant stream it is steering. */
export function applySteeredPromptToSession(
  session: Session,
  sourceMessageId: string,
  queuedAssistantMessageId: string,
  activeAssistantMessageId: string
): Session {
  const sourceMessage = session.messages.find((message) => message.id === sourceMessageId)
  if (!sourceMessage) return session

  const remaining = session.messages.filter(
    (message) => message.id !== sourceMessageId && message.id !== queuedAssistantMessageId
  )
  const activeAssistantIndex = remaining.findIndex(
    (message) => message.id === activeAssistantMessageId
  )
  if (activeAssistantIndex < 0) return session

  const messages = [...remaining]
  messages.splice(activeAssistantIndex, 0, sourceMessage)
  return { ...session, messages, lastActiveTime: Date.now() }
}

export function prepareClaimedPromptRun(
  session: Session,
  sourceMessageId: string,
  assistantMessageId: string,
  reqId: string,
  runMode: RunMode
): PreparedClaimedPromptRun | undefined {
  const sourceIndex = session.messages.findIndex((message) => message.id === sourceMessageId)
  const assistantIndex = session.messages.findIndex((message) => message.id === assistantMessageId)
  if (sourceIndex < 0 || assistantIndex <= sourceIndex) return undefined

  const messages = session.messages.map((message) => {
    if (message.id !== assistantMessageId) return message
    const {
      isRuntimeError: _isRuntimeError,
      errorPayload: _errorPayload,
      tokenSpeed: _tokenSpeed,
      cacheStats: _cacheStats,
      agentRunId: _agentRunId,
      agentRunIds: _agentRunIds,
      agentEvents: _agentEvents,
      ...base
    } = message
    return {
      ...base,
      role: 'assistant' as const,
      content: '',
      reasoning_content: '',
      ...(runMode === 'agent' ? { agentRunId: reqId, agentRunIds: [reqId], agentEvents: [] } : {})
    }
  })
  const preparedSession = { ...session, messages, lastActiveTime: Date.now() }
  return {
    session: preparedSession,
    assistantMessageId,
    messagesBeforeAssistant: messages.slice(0, assistantIndex)
  }
}
