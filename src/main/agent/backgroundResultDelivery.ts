import type { AdmitSessionPromptInput, SessionPromptAdmission } from '../../shared/types'
import { admitSessionPrompt, markSessionPromptRunning } from '../database/sessionPromptStore'
import { globalSessionCoordinator } from '../sessionCoordinator'

export interface BackgroundResultDeliveryDependencies {
  getContextEpoch: (sessionId: string) => number | undefined
  admit: (input: AdmitSessionPromptInput) => { prompt: SessionPromptAdmission; inserted: boolean }
  steer: (
    sessionId: string,
    prompt: {
      admissionId: string
      contextEpoch: number
      messages: SessionPromptAdmission['messages']
    }
  ) => boolean
  markRunning: (admissionId: string) => boolean
  removeSteering: (sessionId: string, admissionId: string) => boolean
}

export interface RouteBackgroundResultInput {
  jobId: string
  promptText: string
  sessionId: string
  contextEpoch: number
}

export interface BackgroundResultRoute {
  disposition: 'steered' | 'queued' | 'stale'
  prompt?: SessionPromptAdmission
}

const defaultDependencies: BackgroundResultDeliveryDependencies = {
  getContextEpoch: (sessionId) => globalSessionCoordinator.getContextEpoch(sessionId),
  admit: admitSessionPrompt,
  steer: (sessionId, prompt) => globalSessionCoordinator.steer(sessionId, prompt),
  markRunning: markSessionPromptRunning,
  removeSteering: (sessionId, admissionId) =>
    globalSessionCoordinator.removeSteering(sessionId, admissionId)
}

const promptIds = (
  jobId: string
): { admissionId: string; sourceMessageId: string; assistantMessageId: string } => ({
  admissionId: `background-result-admission-${jobId}`,
  sourceMessageId: `background-result-source-${jobId}`,
  assistantMessageId: `background-result-assistant-${jobId}`
})

/** Route any detached task result through the durable prompt inbox and active-run steering path. */
export function routeBackgroundResult(
  input: RouteBackgroundResultInput,
  dependencies: BackgroundResultDeliveryDependencies = defaultDependencies
): BackgroundResultRoute {
  const knownEpoch = dependencies.getContextEpoch(input.sessionId)
  if (knownEpoch !== undefined && knownEpoch !== input.contextEpoch) {
    return { disposition: 'stale' }
  }

  const ids = promptIds(input.jobId)
  const stored = dependencies.admit({
    id: ids.admissionId,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    mode: 'steer',
    runMode: 'agent',
    sourceMessageId: ids.sourceMessageId,
    assistantMessageId: ids.assistantMessageId,
    messages: [{ role: 'user', content: input.promptText }]
  })

  let disposition: BackgroundResultRoute['disposition'] = 'queued'
  if (
    stored.prompt.status === 'pending' &&
    dependencies.steer(input.sessionId, {
      admissionId: stored.prompt.id,
      contextEpoch: stored.prompt.contextEpoch,
      messages: stored.prompt.messages
    })
  ) {
    if (dependencies.markRunning(stored.prompt.id)) {
      disposition = 'steered'
    } else {
      dependencies.removeSteering(input.sessionId, stored.prompt.id)
    }
  }

  return { disposition, prompt: stored.prompt }
}
