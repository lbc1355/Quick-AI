import { describe, expect, it, vi } from 'vitest'
import type { ModelReasoningControl } from '../../shared/types'
import { resolveRunReasoningPreference } from './reasoningRunResolution'

describe('resolveRunReasoningPreference', () => {
  const effortControl: ModelReasoningControl = {
    mode: 'effort',
    encoding: 'openai-effort',
    levels: ['low', 'medium', 'high']
  }

  it('uses the request preference for fresh runs', () => {
    expect(
      resolveRunReasoningPreference({
        conversationId: 's1',
        reasoningPreference: 'high',
        reasoningControl: effortControl
      })
    ).toEqual({ requested: 'high', effective: 'high' })
  })

  it('prefers resume manifest snapshots over later UI changes', () => {
    const loadManifest = vi.fn(() => ({
      sessionId: 's1',
      runId: 'run-1',
      requestedReasoningPreference: 'high' as const,
      effectiveReasoningPreference: 'high' as const
    })) as unknown as typeof import('./runManifest').loadRunManifest

    expect(
      resolveRunReasoningPreference({
        conversationId: 's1',
        resumeFromRunId: 'run-1',
        reasoningPreference: 'low',
        reasoningControl: effortControl,
        loadManifest
      })
    ).toEqual({ requested: 'high', effective: 'high' })
    expect(loadManifest).toHaveBeenCalledWith('s1', 'run-1')
  })

  it('falls back to options when resume has no reasoning snapshot', () => {
    expect(
      resolveRunReasoningPreference({
        conversationId: 's1',
        resumeFromRunId: 'run-1',
        reasoningPreference: 'medium',
        reasoningControl: effortControl,
        loadManifest: () => undefined
      })
    ).toEqual({ requested: 'medium', effective: 'medium' })
  })
})
