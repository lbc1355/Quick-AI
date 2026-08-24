import type {
  BackgroundSubagentCompletion,
  BackgroundSubagentResultNotification
} from '../../shared/types'
import {
  type BackgroundResultDeliveryDependencies,
  routeBackgroundResult
} from './backgroundResultDelivery'

export interface DeliverBackgroundSubagentInput {
  completion: BackgroundSubagentCompletion
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
  send: (notification: BackgroundSubagentResultNotification) => void
}

export type BackgroundSubagentDeliveryDependencies = BackgroundResultDeliveryDependencies

const renderResultPrompt = (completion: BackgroundSubagentCompletion): string => {
  const state =
    completion.status === 'completed' || completion.status === 'max_steps'
      ? 'completed'
      : completion.status
  const error = completion.error?.slice(0, 300)
  return [
    'A background subagent has finished.',
    `- Job ID: ${completion.jobId}`,
    `- Status: ${state}`,
    `- Task: ${completion.task}`,
    error ? `- Error summary: ${error}` : '',
    `Read the persisted result with background_job_read {"jobId":"${completion.jobId}"}.`,
    'Do not poll, repeat, or restart the task.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function deliverBackgroundSubagentResult(
  input: DeliverBackgroundSubagentInput,
  dependencies?: BackgroundSubagentDeliveryDependencies
): BackgroundSubagentResultNotification {
  const route = routeBackgroundResult(
    {
      jobId: input.completion.jobId,
      promptText: renderResultPrompt(input.completion),
      sessionId: input.sessionId,
      contextEpoch: input.contextEpoch
    },
    dependencies
  )

  const notification: BackgroundSubagentResultNotification = {
    ...input.completion,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    parentRunId: input.parentRunId,
    parentAssistantMessageId: input.parentAssistantMessageId,
    disposition: route.disposition,
    ...(route.prompt ? { prompt: route.prompt } : {})
  }
  if (route.disposition !== 'duplicate') input.send(notification)
  return notification
}
