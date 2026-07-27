import type { Message, Session, Project } from '../../../../shared/types'
import { getFilesystemProjectPath } from '../../../../shared/projectHelpers'
import { createForkedSession, getRunIdsThroughMessage } from '../../hooks/sessionBranching'
import { prepareMessageForInlineResume } from '../../hooks/chatMessageEvents'
import { advanceSessionContextEpoch } from '../../../../shared/contextEpoch'

export function resolveSessionForSend(
  currentSessions: Session[],
  activeSessionId: string,
  draftSession: Session | null
): {
  session: Session
  updatedSessions: Session[]
  draftSessionCleared: boolean
} {
  const now = Date.now()
  const currentSession = currentSessions.find((s) => s.id === activeSessionId)

  if (currentSession) {
    return { session: currentSession, updatedSessions: currentSessions, draftSessionCleared: false }
  }

  const baseSession =
    draftSession && draftSession.id === activeSessionId
      ? draftSession
      : {
          id: activeSessionId || now.toString(),
          title: '新对话',
          messages: [],
          lastActiveTime: now
        }

  const newSession: Session = {
    ...baseSession,
    lastActiveTime: now
  }
  const nextSessions = [newSession, ...currentSessions]
  return { session: newSession, updatedSessions: nextSessions, draftSessionCleared: true }
}

export function getProjectRunContext(
  session: Session,
  projectList: Project[]
): { projectRoot?: string; projectName?: string } {
  if (!session.projectId) return {}
  const project = projectList.find((item) => item.id === session.projectId)
  if (!project) return {}
  const projectRoot = getFilesystemProjectPath(project)
  // Conversation folders are UI-only containers; they must not become a tool workspace root.
  if (!projectRoot) return {}
  return {
    projectRoot,
    projectName: project.name
  }
}

export function prepareEditOrForkMutation(options: {
  currentSession: Session
  promptToSend: string
  msgId: string
  forceBranch?: boolean
  branchSource?: { messageId: string; runId?: string }
  now: number
}): {
  targetSession: Session
  isForked: boolean
  forkedCachePayload?: { sourceSessionId: string; targetSessionId: string; runIds: string[] }
  removedRunIds?: string[]
  updatedSourceSessionMessages?: Message[]
} {
  const { currentSession, promptToSend, msgId, forceBranch, branchSource, now } = options
  const idx = currentSession.messages.findIndex((m) => m.id === msgId)
  if (idx === -1) {
    throw new Error(`Message not found: ${msgId}`)
  }

  const shouldFork = forceBranch ?? idx < currentSession.messages.length - 1

  if (shouldFork) {
    const branchOf = {
      sessionId: currentSession.id,
      messageId: branchSource?.messageId || msgId,
      ...(branchSource?.runId ? { runId: branchSource.runId } : {})
    }

    const targetSession = advanceSessionContextEpoch(
      createForkedSession({
        sourceSession: currentSession,
        throughIdx: idx,
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        now,
        branchOf,
        transformMessage: (message, messageIdx) =>
          messageIdx === idx ? { ...message, content: promptToSend } : message
      })
    )

    return {
      targetSession,
      isForked: true,
      forkedCachePayload: {
        sourceSessionId: currentSession.id,
        targetSessionId: targetSession.id,
        runIds: getRunIdsThroughMessage(currentSession.messages, idx)
      }
    }
  } else {
    const removedRunIds = currentSession.messages
      .slice(idx + 1)
      .filter((m) => m.role === 'assistant' && m.agentRunId)
      .map((m) => m.agentRunId as string)

    const updatedMessages = currentSession.messages.slice(0, idx + 1).map((m, mIdx) => {
      if (mIdx === idx) {
        return { ...m, content: promptToSend }
      }
      return m
    })

    const targetSession: Session = advanceSessionContextEpoch({
      ...currentSession,
      messages: updatedMessages
    })

    return {
      targetSession,
      isForked: false,
      removedRunIds,
      updatedSourceSessionMessages: updatedMessages
    }
  }
}

export function prepareResumeMutation(options: {
  currentSession: Session
  msgIdx: number
  reqId: string
  now: number
}): {
  targetSession: Session
  isHistoricalResume: boolean
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  forkedCachePayload?: { sourceSessionId: string; targetSessionId: string; runIds: string[] }
  updatedSourceSessionMessages?: Message[]
} {
  const { currentSession, msgIdx, reqId, now } = options
  const failedMsg = currentSession.messages[msgIdx]
  const resumeFromRunId = failedMsg.agentRunId
  if (!resumeFromRunId) {
    throw new Error('No agentRunId to resume from')
  }

  const isHistoricalResume = msgIdx < currentSession.messages.length - 1
  const branchOf = isHistoricalResume
    ? { sessionId: currentSession.id, messageId: failedMsg.id, runId: resumeFromRunId }
    : undefined

  if (isHistoricalResume) {
    const forkedSession = advanceSessionContextEpoch(
      createForkedSession({
        sourceSession: currentSession,
        throughIdx: msgIdx,
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        now,
        branchOf: branchOf!,
        transformMessage: (message, index) =>
          index === msgIdx
            ? {
                ...prepareMessageForInlineResume(message, reqId),
                isBranchFork: true,
                forkedFrom: branchOf
              }
            : message
      })
    )

    return {
      targetSession: forkedSession,
      isHistoricalResume: true,
      branchOf,
      forkedCachePayload: {
        sourceSessionId: currentSession.id,
        targetSessionId: forkedSession.id,
        runIds: getRunIdsThroughMessage(currentSession.messages, msgIdx)
      }
    }
  } else {
    const updatedMessages = currentSession.messages.map((msg, index) => {
      if (index === msgIdx) {
        return prepareMessageForInlineResume(msg, reqId)
      }
      return msg
    })

    const targetSession = advanceSessionContextEpoch({
      ...currentSession,
      messages: updatedMessages
    })

    return {
      targetSession,
      isHistoricalResume: false,
      updatedSourceSessionMessages: updatedMessages
    }
  }
}
