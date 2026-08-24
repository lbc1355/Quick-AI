export const MAX_CONSECUTIVE_BACKGROUND_WAKES = 3

const wakeCounts = new Map<string, number>()

/** Reserve one automatic background-only turn for a session. */
export function tryClaimBackgroundWake(sessionId: string): boolean {
  const current = wakeCounts.get(sessionId) || 0
  if (current >= MAX_CONSECUTIVE_BACKGROUND_WAKES) return false
  wakeCounts.set(sessionId, current + 1)
  return true
}

/** A real user turn starts a fresh automatic-wake allowance. */
export function resetBackgroundWakeBudget(sessionId: string): void {
  wakeCounts.delete(sessionId)
}

export function getBackgroundWakeCount(sessionId: string): number {
  return wakeCounts.get(sessionId) || 0
}

export function clearBackgroundWakeBudgetsForTests(): void {
  wakeCounts.clear()
}
