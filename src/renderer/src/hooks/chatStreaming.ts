import React from 'react'
import type {
  AgentEvent,
  ChatChunkData,
  Message,
  Session,
  SessionResource
} from '../../../shared/types'
import { applyAgentEventToMessage, mergeResourceUpdate } from './chatMessageEvents'
import { applyRuntimeErrorToMessage } from '../features/errors/runtimeErrorMessage'
import { normalizeRuntimeError } from '../../../shared/runtimeErrors'

type UpdateMessageById = (
  msgId: string,
  updater: (m: Message) => Message,
  touchActiveTime?: boolean,
  sessionId?: string
) => void

interface StartStreamingRunOptions {
  reqId: string
  sessionId: string
  assistantMsgId: string
  start: () => void
  formatError: (msg: string) => string
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  sessionsRef: React.MutableRefObject<Session[]>
  updateMessageById: UpdateMessageById
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>
  setActiveReqId: (reqId: string | null) => void
  persistActiveSession: (sessionId?: string) => void
  onCleanup?: () => void
}

const scheduleFrame = (callback: () => void): number => {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(callback, 16)
}

const cancelFrame = (id: number): void => {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id)
    return
  }
  window.clearTimeout(id)
}

export const startStreamingRun = ({
  reqId,
  sessionId,
  assistantMsgId,
  start,
  formatError,
  setSessions,
  sessionsRef,
  updateMessageById,
  setIsGenerating,
  setActiveReqId,
  persistActiveSession,
  onCleanup
}: StartStreamingRunOptions): void => {
  let accumulatedText = ''
  let accumulatedReasoning = ''
  let unsubscribe: () => void = () => {}
  let frameId: number | null = null
  let pendingContent = false
  let pendingReasoning = false
  let pendingEvents: AgentEvent[] = []
  let pendingResourceUpdates: SessionResource[] = []

  const flushPending = (): void => {
    frameId = null

    const hasMessageChanges = pendingContent || pendingReasoning || pendingEvents.length > 0
    const resourceUpdates = pendingResourceUpdates
    const events = pendingEvents
    const contentChanged = pendingContent
    const reasoningChanged = pendingReasoning
    const contentSnapshot = accumulatedText
    const reasoningSnapshot = accumulatedReasoning

    if (!hasMessageChanges && resourceUpdates.length === 0) return

    pendingContent = false
    pendingReasoning = false
    pendingEvents = []
    pendingResourceUpdates = []

    setSessions((prevSessions) => {
      let changed = false
      const next = prevSessions.map((s) => {
        if (s.id !== sessionId) return s

        let nextMessages = s.messages
        let messageChanged = false
        if (hasMessageChanges) {
          nextMessages = s.messages.map((m) => {
            if (m.id !== assistantMsgId) return m

            let nextMessage = m
            if (reasoningChanged && nextMessage.reasoning_content !== reasoningSnapshot) {
              nextMessage = {
                ...nextMessage,
                reasoning_content: reasoningSnapshot
              }
            }
            if (contentChanged && nextMessage.content !== contentSnapshot) {
              nextMessage = {
                ...nextMessage,
                content: contentSnapshot
              }
            }
            for (const event of events) {
              nextMessage = applyAgentEventToMessage(nextMessage, event)
            }
            messageChanged = messageChanged || nextMessage !== m
            return nextMessage
          })
        }

        let nextResources = s.resources
        if (resourceUpdates.length > 0) {
          const resourceOrder = (s.resources || []).map((resource) => resource.id)
          const resourceById = new Map(
            (s.resources || []).map((resource) => [resource.id, resource])
          )

          for (const updatedResource of resourceUpdates) {
            const merged = mergeResourceUpdate(
              resourceById.get(updatedResource.id),
              updatedResource,
              reqId
            )
            if (!resourceById.has(updatedResource.id)) {
              resourceOrder.push(updatedResource.id)
            }
            resourceById.set(updatedResource.id, merged)
          }

          nextResources = resourceOrder
            .map((resourceId) => resourceById.get(resourceId))
            .filter((resource): resource is SessionResource => Boolean(resource))
        }

        if (!messageChanged && resourceUpdates.length === 0) return s
        changed = true
        return {
          ...s,
          ...(messageChanged ? { messages: nextMessages } : {}),
          ...(resourceUpdates.length > 0 ? { resources: nextResources } : {})
        }
      })

      if (!changed) return prevSessions
      sessionsRef.current = next
      return next
    })
  }

  const requestFlush = (): void => {
    if (frameId === null) {
      frameId = scheduleFrame(flushPending)
    }
  }

  const flushPendingNow = (): void => {
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    flushPending()
  }

  const cleanup = (): void => {
    flushPendingNow()
    unsubscribe()
    setIsGenerating(false)
    setActiveReqId(null)
    onCleanup?.()
    persistActiveSession(sessionId)
  }

  unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
    if (data.reqId !== reqId) return

    if (data.error) {
      flushPendingNow()
      const errorText = formatError(data.error)
      updateMessageById(
        assistantMsgId,
        applyRuntimeErrorToMessage(errorText, data.errorPayload),
        false,
        sessionId
      )
      cleanup()
      return
    }

    if (data.done) {
      flushPendingNow()
      if (data.tokenSpeed !== undefined || data.cacheStats !== undefined) {
        updateMessageById(
          assistantMsgId,
          (m) => ({
            ...m,
            ...(data.tokenSpeed !== undefined ? { tokenSpeed: data.tokenSpeed } : {}),
            ...(data.cacheStats !== undefined ? { cacheStats: data.cacheStats } : {})
          }),
          true,
          sessionId
        )
      }
      cleanup()
      return
    }

    if (data.reasoningContent) {
      accumulatedReasoning += data.reasoningContent
      pendingReasoning = true
      requestFlush()
    }

    if (data.content) {
      accumulatedText += data.content
      pendingContent = true
      requestFlush()
    }

    if (data.event) {
      if (data.event.type === 'resource_update') {
        pendingResourceUpdates.push(data.event.resource)
      } else {
        pendingEvents.push(data.event)
      }
      requestFlush()
    }
  })

  try {
    start()
  } catch (err) {
    flushPendingNow()
    const error = err as Error
    console.error(error)
    const errorText = formatError(error.message)
    const errorPayload = normalizeRuntimeError(error, 'renderer')
    updateMessageById(
      assistantMsgId,
      applyRuntimeErrorToMessage(errorText, errorPayload),
      false,
      sessionId
    )
    cleanup()
  }
}
