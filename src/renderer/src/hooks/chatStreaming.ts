import React from 'react'
import { ChatChunkData, Message, Session } from '../../../shared/types'
import { applyAgentEventToMessage, mergeResourceUpdate } from './chatMessageEvents'

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
  setActiveReqId: React.Dispatch<React.SetStateAction<string | null>>
  persistActiveSession: (sessionId?: string) => void
  onCleanup?: () => void
}

const applyRuntimeError = (errorText: string): ((m: Message) => Message) => {
  return (m) => {
    const currentEvents = m.agentEvents || []
    const hasEvents = currentEvents.length > 0
    return {
      ...m,
      content: errorText,
      isRuntimeError: true,
      agentEvents: hasEvents
        ? [...currentEvents, { type: 'final', content: errorText }]
        : currentEvents
    }
  }
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

  const cleanup = (): void => {
    unsubscribe()
    setIsGenerating(false)
    setActiveReqId(null)
    onCleanup?.()
    persistActiveSession(sessionId)
  }

  unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
    if (data.reqId !== reqId) return

    if (data.error) {
      const errorText = formatError(data.error)
      updateMessageById(assistantMsgId, applyRuntimeError(errorText), false, sessionId)
      cleanup()
      return
    }

    if (data.done) {
      if (data.tokenSpeed !== undefined) {
        updateMessageById(
          assistantMsgId,
          (m) => ({ ...m, tokenSpeed: data.tokenSpeed }),
          true,
          sessionId
        )
      }
      cleanup()
      return
    }

    if (data.reasoningContent) {
      accumulatedReasoning += data.reasoningContent
      updateMessageById(
        assistantMsgId,
        (m) => ({
          ...m,
          reasoning_content: accumulatedReasoning
        }),
        true,
        sessionId
      )
    }

    if (data.content) {
      accumulatedText += data.content
      updateMessageById(
        assistantMsgId,
        (m) => ({ ...m, content: accumulatedText }),
        true,
        sessionId
      )
    }

    if (data.event) {
      if (data.event.type === 'resource_update') {
        const updatedResource = data.event.resource
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id !== sessionId) return s

            const existingResources = s.resources || []
            const resIdx = existingResources.findIndex((r) => r.id === updatedResource.id)
            const merged = mergeResourceUpdate(
              resIdx !== -1 ? existingResources[resIdx] : undefined,
              updatedResource,
              reqId
            )
            const newResources =
              resIdx !== -1
                ? existingResources.map((r, i) => (i === resIdx ? merged : r))
                : [...existingResources, merged]

            return {
              ...s,
              resources: newResources,
              lastActiveTime: Date.now()
            }
          })
          sessionsRef.current = next
          return next
        })
      } else {
        updateMessageById(
          assistantMsgId,
          (m) => applyAgentEventToMessage(m, data.event!),
          true,
          sessionId
        )
      }
    }
  })

  try {
    start()
  } catch (err) {
    const error = err as Error
    console.error(error)
    const errorText = formatError(error.message)
    updateMessageById(assistantMsgId, applyRuntimeError(errorText), false, sessionId)
    cleanup()
  }
}
