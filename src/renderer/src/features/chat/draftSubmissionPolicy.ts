import type { SessionPromptAdmissionMode } from '../../../../shared/types'

export type DraftSubmissionAction =
  | { type: 'send' }
  | { type: 'admit'; mode: 'queue' }
  | { type: 'ignore' }

/**
 * A normal submit must never steer an answer that is still being generated.
 * Queueing remains available, but only through the explicit queue action.
 */
export function resolveDraftSubmissionAction(
  isCurrentSessionGenerating: boolean,
  admissionMode?: SessionPromptAdmissionMode
): DraftSubmissionAction {
  if (!isCurrentSessionGenerating) return { type: 'send' }
  if (admissionMode === 'queue') return { type: 'admit', mode: 'queue' }
  return { type: 'ignore' }
}
