import { advanceSessionContextEpoch } from '../../../../shared/contextEpoch'
import { compactAgentEvents } from '../../../../shared/agentEventCompactor'
import type { Message, Session, SessionResource } from '../../../../shared/types'

export const collectMessageRunIds = (messages: Message[]): string[] => {
  const seen = new Set<string>()
  const runIds: string[] = []
  for (const message of messages) {
    for (const runId of message.agentRunIds || (message.agentRunId ? [message.agentRunId] : [])) {
      if (!runId || seen.has(runId)) continue
      seen.add(runId)
      runIds.push(runId)
    }
  }
  return runIds
}

export const prepareSessionRevert = (input: {
  session: Session
  boundaryMessageId: string
  keptResources?: SessionResource[]
  now: number
}): Session => {
  if (input.session.revert) throw new Error('Session already has a staged rollback')
  const boundaryIndex = input.session.messages.findIndex(
    (message) => message.id === input.boundaryMessageId
  )
  if (boundaryIndex < 0) throw new Error(`Message not found: ${input.boundaryMessageId}`)
  if (input.session.messages[boundaryIndex].role !== 'user') {
    throw new Error('Only user messages can be reverted')
  }

  const revertedMessages = input.session.messages.slice(boundaryIndex).map((message) => ({
    ...message,
    agentEvents: message.agentEvents ? compactAgentEvents(message.agentEvents) : undefined
  }))

  return advanceSessionContextEpoch({
    ...input.session,
    messages: input.session.messages.slice(0, boundaryIndex),
    resources: input.keptResources,
    revert: {
      boundaryMessageId: input.boundaryMessageId,
      revertedMessages,
      runIds: collectMessageRunIds(revertedMessages),
      originalResources: input.session.resources,
      revertedAt: input.now
    },
    lastActiveTime: input.now
  })
}

const clearFileRevertedMarkers = (message: Message): Message => {
  if (!message.agentEvents?.some((event) => event.type === 'file_changes' && event.revertedAt)) {
    return message
  }
  return {
    ...message,
    agentEvents: message.agentEvents.map((event) =>
      event.type === 'file_changes' && event.revertedAt
        ? { ...event, revertedAt: undefined }
        : event
    )
  }
}

export const restoreSessionRevert = (session: Session, now: number): Session => {
  if (!session.revert) throw new Error('Session does not have a staged rollback')
  return advanceSessionContextEpoch({
    ...session,
    messages: [
      ...session.messages,
      ...session.revert.revertedMessages.map(clearFileRevertedMarkers)
    ],
    resources: session.revert.originalResources,
    revert: undefined,
    lastActiveTime: now
  })
}

export const commitSessionRevert = (
  session: Session
): { session: Session; committedRunIds: string[]; originalResources?: SessionResource[] } => {
  if (!session.revert) return { session, committedRunIds: [] }
  return {
    session: { ...session, revert: undefined },
    committedRunIds: session.revert.runIds,
    originalResources: session.revert.originalResources
  }
}

/**
 * Discard a staged /clear undo. The cleared conversation's resources become collectable once the
 * clear is committed, so the caller can prune them against the surviving sessions.
 */
export const commitSessionClearDraft = (
  session: Session
): { session: Session; originalResources?: SessionResource[] } => {
  if (!session.clearedDraft) return { session }
  return {
    session: { ...session, clearedDraft: undefined },
    originalResources: session.clearedDraft.resources
  }
}
