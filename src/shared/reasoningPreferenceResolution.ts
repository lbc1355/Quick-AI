import type { ModelReasoningControl, ReasoningPreference, Session } from './types'
import {
  fitReasoningPreference,
  getReasoningPreferenceKey,
  normalizeReasoningPreference,
  resolveEffectiveReasoningPreference
} from './reasoningControl'

export function resolveSessionReasoningPreference(input: {
  session?: Pick<Session, 'reasoningPreference'> | null
  providerId?: string
  modelId?: string
  reasoningDefaults?: Record<string, ReasoningPreference>
  control?: ModelReasoningControl
}): ReasoningPreference {
  const modelDefault =
    input.providerId && input.modelId
      ? input.reasoningDefaults?.[getReasoningPreferenceKey(input.providerId, input.modelId)]
      : undefined
  return resolveEffectiveReasoningPreference({
    control: input.control,
    sessionPreference: input.session?.reasoningPreference,
    modelDefault
  })
}

export function fitSessionReasoningPreferenceForModel(
  preference: ReasoningPreference | undefined,
  control: ModelReasoningControl | undefined
): ReasoningPreference {
  return fitReasoningPreference(control, normalizeReasoningPreference(preference))
}
