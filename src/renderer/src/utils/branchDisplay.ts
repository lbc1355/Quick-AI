import type { Session } from '../../../shared/types'

export interface BranchRef {
  sessionId: string
  messageId: string
  runId?: string
}

export interface BranchDisplayInfo {
  sourceSessionId: string
  sourceMessageId: string
  sourceRunId?: string
  sourceTitle: string
  shortRunId?: string
  sourceLabel: string
  sourceExists: boolean
}

export function shortBranchRunId(runId?: string): string | undefined {
  const value = runId?.trim()
  if (!value) return undefined
  return value.length <= 8 ? value : value.slice(0, 8)
}

export function getBranchDisplayInfo(
  branchOf: BranchRef | undefined,
  sessions: Pick<Session, 'id' | 'title'>[],
  fallbackTitle = 'Source chat'
): BranchDisplayInfo | null {
  if (!branchOf) return null

  const sourceSession = sessions.find((session) => session.id === branchOf.sessionId)
  const sourceTitle = sourceSession?.title?.trim() || fallbackTitle
  const shortRunId = shortBranchRunId(branchOf.runId)
  const sourceLabel = shortRunId ? `${sourceTitle} · run ${shortRunId}` : sourceTitle

  return {
    sourceSessionId: branchOf.sessionId,
    sourceMessageId: branchOf.messageId,
    sourceRunId: branchOf.runId,
    sourceTitle,
    shortRunId,
    sourceLabel,
    sourceExists: Boolean(sourceSession)
  }
}
