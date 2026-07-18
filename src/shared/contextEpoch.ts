import type { Session } from './types'

export const normalizeContextEpoch = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

export const getSessionContextEpoch = (session: Pick<Session, 'contextEpoch'>): number =>
  normalizeContextEpoch(session.contextEpoch)

export const advanceSessionContextEpoch = <T extends Pick<Session, 'contextEpoch'>>(
  session: T
): T & { contextEpoch: number } => ({
  ...session,
  contextEpoch: getSessionContextEpoch(session) + 1
})

export const isSessionContextEpochCurrent = (
  sessions: Array<Pick<Session, 'id' | 'contextEpoch'>>,
  sessionId: string,
  contextEpoch: number
): boolean => {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  return !!session && getSessionContextEpoch(session) === normalizeContextEpoch(contextEpoch)
}
