import type { AgentEvent } from '../../shared/types'

/**
 * Main-agent runs intentionally have no ordinary user-facing step limit. This independent ceiling
 * is only an emergency brake for pathological runs that keep making superficially different,
 * successful tool calls and therefore cannot be caught by LoopGuard's repetition/failure checks.
 */
export const MAIN_AGENT_EMERGENCY_STEP_LIMIT = 200

export type ForcedFinalReason = 'loop_guard' | 'step_limit' | 'safety_limit'

export const resolveAgentLoopStepLimit = (maxSteps: number): number =>
  Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : MAIN_AGENT_EMERGENCY_STEP_LIMIT

/** Persistable/event-safe representation: zero means an unbounded main run. */
export const toReportedMaxSteps = (maxSteps: number): number =>
  Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : 0

export const resolveForcedFinalReason = (
  maxSteps: number,
  haltRequested: boolean
): ForcedFinalReason => {
  if (haltRequested) return 'loop_guard'
  return Number.isFinite(maxSteps) && maxSteps > 0 ? 'step_limit' : 'safety_limit'
}

export const getForcedFinalStatus = (
  reason: ForcedFinalReason
): Extract<AgentEvent, { type: 'agent_end' }>['status'] =>
  reason === 'step_limit' ? 'max_steps' : 'safety_stop'

export const getForcedFinalError = (reason: ForcedFinalReason): string | undefined => {
  if (reason === 'loop_guard') {
    return 'Agent stopped safely after repeated consecutive tool failures.'
  }
  if (reason === 'safety_limit') {
    return `Agent stopped safely after reaching the emergency limit of ${MAIN_AGENT_EMERGENCY_STEP_LIMIT} model turns.`
  }
  return undefined
}
