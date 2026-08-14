import { describe, expect, it } from 'vitest'
import {
  MAIN_AGENT_EMERGENCY_STEP_LIMIT,
  getForcedFinalError,
  getForcedFinalStatus,
  resolveAgentLoopStepLimit,
  resolveForcedFinalReason,
  toReportedMaxSteps
} from './agentRunLimits'

describe('agentRunLimits', () => {
  it('keeps finite skill limits unchanged', () => {
    expect(resolveAgentLoopStepLimit(12)).toBe(12)
    expect(toReportedMaxSteps(12)).toBe(12)
    expect(resolveForcedFinalReason(12, false)).toBe('step_limit')
    expect(getForcedFinalStatus('step_limit')).toBe('max_steps')
  })

  it('gives unbounded main runs an event-safe marker and an emergency brake', () => {
    expect(resolveAgentLoopStepLimit(Infinity)).toBe(MAIN_AGENT_EMERGENCY_STEP_LIMIT)
    expect(toReportedMaxSteps(Infinity)).toBe(0)
    expect(resolveForcedFinalReason(Infinity, false)).toBe('safety_limit')
    expect(getForcedFinalStatus('safety_limit')).toBe('safety_stop')
    expect(getForcedFinalError('safety_limit')).toContain(String(MAIN_AGENT_EMERGENCY_STEP_LIMIT))
  })

  it('reports loop-guard halts as safety stops even for finite runs', () => {
    expect(resolveForcedFinalReason(8, true)).toBe('loop_guard')
    expect(getForcedFinalStatus('loop_guard')).toBe('safety_stop')
    expect(getForcedFinalError('loop_guard')).toContain('tool failures')
  })
})
