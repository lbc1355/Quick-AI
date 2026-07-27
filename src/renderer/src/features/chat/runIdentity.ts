import type { Session } from '../../../../shared/types'

const DEFAULT_SESSION_TITLE_LENGTH = 15

export interface RunIdentityClock {
  now: () => number
  random: () => number
}

const systemClock: RunIdentityClock = { now: Date.now, random: Math.random }

export const createRunId = (prefix = '', clock: RunIdentityClock = systemClock): string =>
  `${prefix}${clock.now()}-${clock.random().toString(36).substring(2, 8)}`

/**
 * Allocate the `(user, assistant)` id pair for a queued prompt.
 *
 * Ids are timestamps, and a queued prompt can be admitted in the same millisecond as an existing
 * message, so the base timestamp is walked forward until both it and its `+1` successor are free.
 * Colliding here would make the placeholder overwrite an unrelated message.
 */
export const createMessagePairIds = (
  sessions: Session[],
  now: number
): { sourceMessageId: string; assistantMessageId: string } => {
  const existingIds = new Set(
    sessions.flatMap((session) => session.messages.map((message) => message.id))
  )
  let sourceTimestamp = now
  while (existingIds.has(String(sourceTimestamp)) || existingIds.has(String(sourceTimestamp + 1))) {
    sourceTimestamp += 2
  }
  return {
    sourceMessageId: String(sourceTimestamp),
    assistantMessageId: String(sourceTimestamp + 1)
  }
}

/** Titles that still mean "untitled" and may be overwritten by auto-derive. */
const DEFAULT_SESSION_TITLES = new Set(['新对话', 'New chat', 'Chat', '聊天对话'])

/** True when the title is empty or still one of the auto-generated placeholders. */
export const isDefaultSessionTitle = (title: string | undefined): boolean => {
  const trimmed = title?.trim()
  return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed)
}

/** Derive a session title from the first prompt, falling back when the prompt is blank. */
export const deriveSessionTitle = (prompt: string, fallback: string): string =>
  prompt.substring(0, DEFAULT_SESSION_TITLE_LENGTH) || fallback
