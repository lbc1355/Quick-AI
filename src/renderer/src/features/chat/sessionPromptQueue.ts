import type {
  BackgroundSubagentEventNotification,
  BackgroundSubagentResultNotification,
  BackgroundShellResultNotification,
  Message,
  RunMode,
  Session,
  SessionPromptAdmission
} from '../../../../shared/types'
import { applyAgentEventToMessage } from '../../../../shared/agentEventReducer'
import { BACKGROUND_RESULT_SOURCE_PREFIX } from './messageVisibility'

const promptText = (admission: SessionPromptAdmission): string => {
  const message = admission.messages.findLast((item) => item.role === 'user')
  return typeof message?.content === 'string' ? message.content : '后台任务已完成。'
}

const ownsBackgroundSubagent = (
  message: Message,
  routing: {
    parentRunId: string
    parentAssistantMessageId?: string
    subagentId?: string
  }
): boolean => {
  if (routing.parentAssistantMessageId) {
    return message.id === routing.parentAssistantMessageId
  }

  const ownsParentRun =
    message.agentRunId === routing.parentRunId || message.agentRunIds?.includes(routing.parentRunId)
  if (ownsParentRun) return true

  const ownsSubagent = routing.subagentId
    ? message.agentEvents?.some(
        (event) => event.type === 'subagent_start' && event.subagentId === routing.subagentId
      )
    : false
  return Boolean(ownsSubagent)
}

export function applyBackgroundSubagentEventNotification(
  session: Session,
  notification: BackgroundSubagentEventNotification
): Session {
  let changed = false
  const subagentId = notification.event.subagentId
  const messages = session.messages.map((message) => {
    if (
      changed ||
      !ownsBackgroundSubagent(message, {
        parentRunId: notification.parentRunId,
        parentAssistantMessageId: notification.parentAssistantMessageId,
        subagentId
      })
    ) {
      return message
    }
    changed = true
    return applyAgentEventToMessage(message, notification.event)
  })
  return changed ? { ...session, messages } : session
}

export function materializeBackgroundPrompt(
  session: Session,
  admission: SessionPromptAdmission
): Session {
  if (!admission.sourceMessageId.startsWith(BACKGROUND_RESULT_SOURCE_PREFIX)) return session
  if (!admission.assistantMessageId) return session
  if (session.messages.some((message) => message.id === admission.sourceMessageId)) return session

  return appendQueuedPromptToSession(
    session,
    {
      id: admission.sourceMessageId,
      role: 'user',
      content: promptText(admission),
      isSynthetic: true,
      isInternal: true
    },
    {
      id: admission.assistantMessageId,
      role: 'assistant',
      content: '⏳ 正在处理后台任务结果',
      reasoning_content: ''
    }
  )
}

export function applyBackgroundSubagentNotification(
  session: Session,
  notification: BackgroundSubagentResultNotification,
  activeAssistantMessageId?: string
): Session {
  let changed = false
  let completionAttached = false
  let messages = session.messages.map((message) => {
    if (
      completionAttached ||
      !ownsBackgroundSubagent(message, {
        parentRunId: notification.parentRunId,
        parentAssistantMessageId: notification.parentAssistantMessageId,
        subagentId: notification.subagentId
      })
    ) {
      return message
    }
    completionAttached = true
    changed = true
    return applyAgentEventToMessage(message, {
      type: 'subagent_end',
      subagentId: notification.subagentId,
      status: notification.status,
      finalAnswer: notification.result,
      error: notification.error,
      durationMs: notification.durationMs
    })
  })

  if (notification.disposition === 'steered' && notification.prompt) {
    const sourceId = notification.prompt.sourceMessageId
    if (!messages.some((message) => message.id === sourceId)) {
      const source: Message = {
        id: sourceId,
        role: 'user',
        content: promptText(notification.prompt),
        isSynthetic: true,
        isInternal: true
      }
      const assistantIndex = activeAssistantMessageId
        ? messages.findIndex((message) => message.id === activeAssistantMessageId)
        : -1
      messages = [...messages]
      if (assistantIndex >= 0) messages.splice(assistantIndex, 0, source)
      else messages.push(source)
      changed = true
    }
  }

  return changed ? { ...session, messages, lastActiveTime: Date.now() } : session
}

export function applyBackgroundShellNotification(
  session: Session,
  notification: BackgroundShellResultNotification,
  activeAssistantMessageId?: string
): Session {
  let updated = session
  const completedResource = notification.resource
  if (completedResource) {
    const existing = session.resources?.find((resource) => resource.id === completedResource.id)
    const resource = {
      ...completedResource,
      runIds: Array.from(new Set([...(existing?.runIds || []), notification.parentRunId]))
    }
    const resources = existing
      ? (session.resources || []).map((item) => (item.id === resource.id ? resource : item))
      : [...(session.resources || []), resource]
    updated = { ...updated, resources, lastActiveTime: Date.now() }
  }

  if (notification.disposition !== 'steered' || !notification.prompt) return updated
  const sourceId = notification.prompt.sourceMessageId
  if (updated.messages.some((message) => message.id === sourceId)) return updated

  const source: Message = {
    id: sourceId,
    role: 'user',
    content: promptText(notification.prompt),
    isSynthetic: true,
    isInternal: true
  }
  const assistantIndex = activeAssistantMessageId
    ? updated.messages.findIndex((message) => message.id === activeAssistantMessageId)
    : -1
  const messages = [...updated.messages]
  if (assistantIndex >= 0) messages.splice(assistantIndex, 0, source)
  else messages.push(source)
  return { ...updated, messages, lastActiveTime: Date.now() }
}

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

/** Attach the durable admission identity only after the main process confirms it is pending. */
export function markQueuedPromptInSessions(
  sessions: Session[],
  input: {
    admissionId: string
    sessionId: string
    sourceMessageId: string
    assistantMessageId: string
  }
): Session[] {
  const queuedPrompt = {
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    assistantMessageId: input.assistantMessageId
  }
  return sessions.map((session) => {
    if (session.id !== input.sessionId) return session
    const hasSource = session.messages.some((message) => message.id === input.sourceMessageId)
    const hasAssistant = session.messages.some((message) => message.id === input.assistantMessageId)
    if (!hasSource || !hasAssistant) return session
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === input.sourceMessageId || message.id === input.assistantMessageId
          ? { ...message, queuedPrompt }
          : message
      )
    }
  })
}

export const withoutQueuedPrompt = (message: Message): Message => {
  if (!message.queuedPrompt) return message
  const { queuedPrompt: _queuedPrompt, ...rest } = message
  return rest
}

/** Remove a cancelled pending admission and its assistant placeholder from the transcript. */
export function removeQueuedPromptFromSessions(
  sessions: Session[],
  input: {
    admissionId: string
    sessionId: string
    sourceMessageId: string
    assistantMessageId: string
  }
): Session[] {
  return sessions.map((session) => {
    if (session.id !== input.sessionId) return session
    const source = session.messages.find((message) => message.id === input.sourceMessageId)
    if (source?.queuedPrompt?.admissionId !== input.admissionId) return session
    return {
      ...session,
      messages: session.messages.filter(
        (message) => message.id !== input.sourceMessageId && message.id !== input.assistantMessageId
      ),
      lastActiveTime: Date.now()
    }
  })
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
  messages.splice(activeAssistantIndex, 0, withoutQueuedPrompt(sourceMessage))
  return { ...session, messages, lastActiveTime: Date.now() }
}

/**
 * Fold an accepted steer into the session list.
 *
 * A steered prompt joins the run already in flight, so its "queued" placeholder must go. When the
 * active assistant bubble is known the user message is moved just above it, keeping the transcript
 * in the order the model will actually see. Without that anchor there is nothing to insert before,
 * so only the placeholder is dropped and the user message stays where it landed.
 */
export function applySteeredAdmission(
  sessions: Session[],
  input: {
    sessionId: string
    sourceMessageId: string
    queuedAssistantMessageId: string
    activeAssistantMessageId?: string
  }
): Session[] {
  return sessions.map((session) => {
    if (session.id !== input.sessionId) return session
    if (!input.activeAssistantMessageId) {
      return {
        ...session,
        messages: session.messages
          .filter((message) => message.id !== input.queuedAssistantMessageId)
          .map((message) =>
            message.id === input.sourceMessageId ? withoutQueuedPrompt(message) : message
          )
      }
    }
    return applySteeredPromptToSession(
      session,
      input.sourceMessageId,
      input.queuedAssistantMessageId,
      input.activeAssistantMessageId
    )
  })
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
    if (message.id === sourceMessageId) return withoutQueuedPrompt(message)
    if (message.id !== assistantMessageId) return message
    const {
      isRuntimeError: _isRuntimeError,
      errorPayload: _errorPayload,
      tokenSpeed: _tokenSpeed,
      cacheStats: _cacheStats,
      agentRunId: _agentRunId,
      agentRunIds: _agentRunIds,
      agentEvents: _agentEvents,
      queuedPrompt: _queuedPrompt,
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
