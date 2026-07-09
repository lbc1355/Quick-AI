const MIN_PLAUSIBLE_MESSAGE_TIMESTAMP = 946684800000 // 2000-01-01
const MAX_PLAUSIBLE_MESSAGE_TIMESTAMP = 4102444800000 // 2100-01-01

/**
 * Date-level temporal anchor. Deliberately excludes clock time so a message's prompt text remains
 * stable throughout the day and across future replays of the same conversation history.
 */
export function buildDateLine(now: Date = new Date()): string {
  const date = now.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  return `Current date: ${date} (${weekday}). The clock time within the day is not provided.`
}

export function buildDateContext(
  now: Date = new Date(),
  instruction = 'Use this only as temporal context for this user message.'
): string {
  return `<date_context>\n${buildDateLine(now)}\n${instruction}\n</date_context>`
}

export function getDateFromMessageId(messageId: string): Date | null {
  const timestamp = Number(messageId)
  if (
    !Number.isFinite(timestamp) ||
    timestamp < MIN_PLAUSIBLE_MESSAGE_TIMESTAMP ||
    timestamp > MAX_PLAUSIBLE_MESSAGE_TIMESTAMP
  ) {
    return null
  }
  return new Date(timestamp)
}

/**
 * Stable day-level key (YYYY-MM-DD) for a date, matching the granularity used by buildDateLine.
 * Used to detect whether a user message falls on a different calendar day than the previous one.
 */
export function getDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}
