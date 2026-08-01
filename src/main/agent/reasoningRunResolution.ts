import { fitReasoningPreference, normalizeReasoningPreference } from '../../shared/reasoningControl'
import type { ModelReasoningControl, ReasoningPreference } from '../../shared/types'
import { loadRunManifest } from './runManifest'

export interface ResolveRunReasoningPreferenceInput {
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  conversationId: string
  reasoningPreference?: ReasoningPreference
  reasoningControl?: ModelReasoningControl
  loadManifest?: typeof loadRunManifest
}

/**
 * Resolve thinking intensity for an agent run.
 * Resume prefers the original run manifest snapshot over current UI/settings.
 */
export function resolveRunReasoningPreference(input: ResolveRunReasoningPreferenceInput): {
  requested: ReasoningPreference
  effective: ReasoningPreference
} {
  const loadManifest = input.loadManifest || loadRunManifest

  if (input.resumeFromRunId) {
    const manifest = loadManifest(
      input.resumeSourceSessionId || input.conversationId,
      input.resumeFromRunId
    )
    const fromManifest =
      manifest?.effectiveReasoningPreference || manifest?.requestedReasoningPreference
    if (fromManifest) {
      const requested = normalizeReasoningPreference(
        manifest?.requestedReasoningPreference || fromManifest
      )
      const effective = fitReasoningPreference(
        input.reasoningControl,
        normalizeReasoningPreference(fromManifest)
      )
      return { requested, effective }
    }
  }

  const requested = normalizeReasoningPreference(input.reasoningPreference)
  const effective = fitReasoningPreference(input.reasoningControl, requested)
  return { requested, effective }
}
