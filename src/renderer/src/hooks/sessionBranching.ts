import { Message, Session, SessionResource } from '../../../shared/types'

export interface BranchRef {
  sessionId: string
  messageId: string
  runId?: string
}

export const getRunIdsThroughMessage = (messages: Message[], throughIdx: number): string[] => {
  return Array.from(
    new Set(
      messages
        .slice(0, throughIdx + 1)
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.agentRunIds || (m.agentRunId ? [m.agentRunId] : []))
    )
  )
}

export const forkResourcesForRuns = (
  resources: SessionResource[] | undefined,
  keptRunIds: string[]
): SessionResource[] => {
  if (!resources || resources.length === 0) return []
  const kept = new Set(keptRunIds)

  return resources
    .map((resource) => {
      const runIds = resource.runIds ?? []
      if (runIds.length === 0) return resource
      const retainedRunIds = runIds.filter((id) => kept.has(id))
      if (retainedRunIds.length === 0) return undefined
      return {
        ...resource,
        runIds: retainedRunIds
      }
    })
    .filter((resource): resource is SessionResource => !!resource)
}

export const createForkedSession = ({
  sourceSession,
  throughIdx,
  id,
  now,
  branchOf,
  titleSuffix = ' 分支',
  transformMessage
}: {
  sourceSession: Session
  throughIdx: number
  id: string
  now: number
  branchOf: BranchRef
  titleSuffix?: string
  transformMessage?: (message: Message, index: number) => Message
}): Session => {
  const clampedThroughIdx = Math.max(-1, Math.min(throughIdx, sourceSession.messages.length - 1))
  const keptRunIds = getRunIdsThroughMessage(sourceSession.messages, clampedThroughIdx)
  const keptMessages = sourceSession.messages
    .slice(0, clampedThroughIdx + 1)
    .map((message, idx) => {
      const copied = {
        ...message,
        id: message.id.includes('-fork-')
          ? `${message.id.split('-fork-')[0]}-fork-${id}`
          : `${message.id}-fork-${id}`
      }
      return transformMessage ? transformMessage(copied, idx) : copied
    })

  return {
    id,
    title: `${sourceSession.title || 'Chat'}${titleSuffix}`,
    messages: keptMessages,
    contextEpoch: sourceSession.contextEpoch,
    resources: forkResourcesForRuns(sourceSession.resources, keptRunIds),
    lastActiveTime: now,
    projectId: sourceSession.projectId,
    branchOf
  }
}
