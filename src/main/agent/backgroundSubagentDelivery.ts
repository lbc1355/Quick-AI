import type {
  AdmitSessionPromptInput,
  BackgroundSubagentCompletion,
  BackgroundSubagentResultNotification,
  SessionPromptAdmission
} from '../../shared/types'
import { admitSessionPrompt, markSessionPromptRunning } from '../database/sessionPromptStore'
import { globalSessionCoordinator } from '../sessionCoordinator'

export interface DeliverBackgroundSubagentInput {
  completion: BackgroundSubagentCompletion
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
  send: (notification: BackgroundSubagentResultNotification) => void
}

export interface BackgroundSubagentDeliveryDependencies {
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

const defaultDependencies: BackgroundSubagentDeliveryDependencies = {
  getContextEpoch: (sessionId) => globalSessionCoordinator.getContextEpoch(sessionId),
  admit: admitSessionPrompt,
  steer: (sessionId, prompt) => globalSessionCoordinator.steer(sessionId, prompt),
  markRunning: markSessionPromptRunning,
  removeSteering: (sessionId, admissionId) =>
    globalSessionCoordinator.removeSteering(sessionId, admissionId)
}

const renderResultPrompt = (completion: BackgroundSubagentCompletion): string => {
  const state =
    completion.status === 'completed' || completion.status === 'max_steps' ? '已完成' : '失败'
  return [
    '### 后台子任务结果（自动消息）',
    `- Job ID：${completion.jobId}`,
    `- 状态：${state}`,
    `- 任务：${completion.task}`,
    completion.result ? `\n结果：\n${completion.result}` : '',
    completion.error ? `\n错误：\n${completion.error}` : '',
    '\n请在下一次回复中使用这个结果，不要重复执行或轮询该任务。'
  ]
    .filter(Boolean)
    .join('\n')
}

const promptIds = (
  jobId: string
): { admissionId: string; sourceMessageId: string; assistantMessageId: string } => ({
  admissionId: `background-result-admission-${jobId}`,
  sourceMessageId: `background-result-source-${jobId}`,
  assistantMessageId: `background-result-assistant-${jobId}`
})

export function deliverBackgroundSubagentResult(
  input: DeliverBackgroundSubagentInput,
  dependencies: BackgroundSubagentDeliveryDependencies = defaultDependencies
): BackgroundSubagentResultNotification {
  const knownEpoch = dependencies.getContextEpoch(input.sessionId)
  if (knownEpoch !== undefined && knownEpoch !== input.contextEpoch) {
    const stale: BackgroundSubagentResultNotification = {
      ...input.completion,
      sessionId: input.sessionId,
      contextEpoch: input.contextEpoch,
      parentRunId: input.parentRunId,
      parentAssistantMessageId: input.parentAssistantMessageId,
      disposition: 'stale'
    }
    input.send(stale)
    return stale
  }

  const ids = promptIds(input.completion.jobId)
  const stored = dependencies.admit({
    id: ids.admissionId,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    mode: 'steer',
    runMode: 'agent',
    sourceMessageId: ids.sourceMessageId,
    assistantMessageId: ids.assistantMessageId,
    messages: [{ role: 'user', content: renderResultPrompt(input.completion) }]
  })

  let disposition: BackgroundSubagentResultNotification['disposition'] = 'queued'
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

  const notification: BackgroundSubagentResultNotification = {
    ...input.completion,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    parentRunId: input.parentRunId,
    parentAssistantMessageId: input.parentAssistantMessageId,
    disposition,
    prompt: stored.prompt
  }
  input.send(notification)
  return notification
}
