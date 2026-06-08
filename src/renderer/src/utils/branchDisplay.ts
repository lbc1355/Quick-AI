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

export interface BranchChildInfo {
  sessionId: string
  title: string
  messageCount: number
  lastActiveTime?: number
  sourceRunId?: string
  shortRunId?: string
}

export function getBranchSourceKey(sessionId: string, messageId: string): string {
  return `${sessionId}::${messageId}`
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

export function buildBranchChildIndex(
  sessions: Pick<Session, 'id' | 'title' | 'messages' | 'lastActiveTime' | 'branchOf'>[]
): Record<string, BranchChildInfo[]> {
  const index: Record<string, BranchChildInfo[]> = {}

  for (const session of sessions) {
    if (!session.branchOf) continue
    const key = getBranchSourceKey(session.branchOf.sessionId, session.branchOf.messageId)
    const item: BranchChildInfo = {
      sessionId: session.id,
      title: session.title?.trim() || 'Branch chat',
      messageCount: session.messages.length,
      lastActiveTime: session.lastActiveTime,
      sourceRunId: session.branchOf.runId,
      shortRunId: shortBranchRunId(session.branchOf.runId)
    }

    index[key] = [...(index[key] || []), item]
  }

  for (const children of Object.values(index)) {
    children.sort((a, b) => {
      const aTime = a.lastActiveTime || 0
      const bTime = b.lastActiveTime || 0
      return bTime - aTime
    })
  }

  return index
}
