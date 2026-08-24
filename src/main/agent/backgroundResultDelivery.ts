import type {
  AdmitSessionPromptInput,
  BackgroundJobInfo,
  BackgroundJobReportDisposition,
  SessionPromptAdmission
} from '../../shared/types'
import { admitSessionPrompt, markSessionPromptRunning } from '../database/sessionPromptStore'
import { globalSessionCoordinator } from '../sessionCoordinator'
import { getBackgroundJob, markBackgroundJobReported } from './backgroundJobManager'

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
  getJob: (jobId: string) => BackgroundJobInfo | undefined
  markReported: (
    jobId: string,
    disposition: BackgroundJobReportDisposition
  ) => BackgroundJobInfo | undefined
}

export interface RouteBackgroundResultInput {
  jobId: string
  promptText: string
  sessionId: string
  contextEpoch: number
}

export interface BackgroundResultRoute {
  disposition: 'steered' | 'queued' | 'stale' | 'duplicate'
  prompt?: SessionPromptAdmission
}

const defaultDependencies: BackgroundResultDeliveryDependencies = {
  getContextEpoch: (sessionId) => globalSessionCoordinator.getContextEpoch(sessionId),
  admit: admitSessionPrompt,
  steer: (sessionId, prompt) => globalSessionCoordinator.steer(sessionId, prompt),
  markRunning: markSessionPromptRunning,
  removeSteering: (sessionId, admissionId) =>
    globalSessionCoordinator.removeSteering(sessionId, admissionId),
  getJob: getBackgroundJob,
  markReported: markBackgroundJobReported
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
  if (dependencies.getJob(input.jobId)?.reportedAt !== undefined) {
    return { disposition: 'duplicate' }
  }
  const knownEpoch = dependencies.getContextEpoch(input.sessionId)
  if (knownEpoch !== undefined && knownEpoch !== input.contextEpoch) {
    dependencies.markReported(input.jobId, 'stale')
    return { disposition: 'stale' }
  }

  const ids = promptIds(input.jobId)
  const stored = dependencies.admit({
    id: ids.admissionId,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    mode: 'steer',
    origin: 'background',
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

  dependencies.markReported(input.jobId, disposition)
  return { disposition, prompt: stored.prompt }
}
