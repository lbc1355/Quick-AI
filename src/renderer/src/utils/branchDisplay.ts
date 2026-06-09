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

type BranchFamilySession = Pick<
  Session,
  'id' | 'title' | 'messages' | 'lastActiveTime' | 'branchOf'
>

export interface BranchFamilyMemberInfo<T extends BranchFamilySession = BranchFamilySession> {
  session: T
  sessionId: string
  title: string
  messageCount: number
  lastActiveTime?: number
  isRoot: boolean
  depth: number
  branchIndex?: number
  sourceSessionId?: string
  sourceTitle?: string
  sourceRunId?: string
  shortRunId?: string
}

export interface BranchFamilyInfo<T extends BranchFamilySession = BranchFamilySession> {
  rootSession: T
  rootSessionId: string
  rootTitle: string
  members: BranchFamilyMemberInfo<T>[]
  branchCount: number
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

export function getBranchFamilyRootId(
  sessionId: string,
  sessions: Pick<Session, 'id' | 'branchOf'>[]
): string {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  let currentId = sessionId
  const visited = new Set<string>()

  while (true) {
    if (visited.has(currentId)) return sessionId
    visited.add(currentId)

    const current = byId.get(currentId)
    const parentId = current?.branchOf?.sessionId
    if (!parentId || !byId.has(parentId) || parentId === currentId) return currentId

    currentId = parentId
  }
}

function getBranchDepth(
  sessionId: string,
  rootSessionId: string,
  sessions: BranchFamilySession[]
): number {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  let currentId = sessionId
  let depth = 0
  const visited = new Set<string>()

  while (currentId !== rootSessionId) {
    if (visited.has(currentId)) return depth
    visited.add(currentId)

    const parentId = byId.get(currentId)?.branchOf?.sessionId
    if (!parentId || !byId.has(parentId)) return depth

    depth += 1
    currentId = parentId
  }

  return depth
}

export function buildBranchFamilyInfo<T extends BranchFamilySession>(
  rootSessionId: string,
  sessions: T[]
): BranchFamilyInfo<T> | null {
  const rootSession = sessions.find((session) => session.id === rootSessionId)
  if (!rootSession) return null

  const familySessions = sessions
    .filter((session) => getBranchFamilyRootId(session.id, sessions) === rootSessionId)
    .sort((a, b) => {
      if (a.id === rootSessionId) return -1
      if (b.id === rootSessionId) return 1

      const aTime = a.lastActiveTime || Number(a.id) || 0
      const bTime = b.lastActiveTime || Number(b.id) || 0
      return bTime - aTime
    })

  let branchIndex = 0
  const members = familySessions.map((session) => {
    const sourceSession = session.branchOf
      ? sessions.find((candidate) => candidate.id === session.branchOf?.sessionId)
      : undefined
    const isRoot = session.id === rootSessionId
    const member: BranchFamilyMemberInfo<T> = {
      session,
      sessionId: session.id,
      title: session.title?.trim() || (isRoot ? 'Root chat' : 'Branch chat'),
      messageCount: session.messages.length,
      lastActiveTime: session.lastActiveTime,
      isRoot,
      depth: isRoot ? 0 : getBranchDepth(session.id, rootSessionId, sessions),
      sourceSessionId: session.branchOf?.sessionId,
      sourceTitle: sourceSession?.title?.trim(),
      sourceRunId: session.branchOf?.runId,
      shortRunId: shortBranchRunId(session.branchOf?.runId)
    }

    if (!isRoot) {
      branchIndex += 1
      member.branchIndex = branchIndex
    }

    return member
  })

  return {
    rootSession,
    rootSessionId,
    rootTitle: rootSession.title?.trim() || 'Root chat',
    members,
    branchCount: Math.max(0, members.length - 1)
  }
}
