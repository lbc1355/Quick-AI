import type {
  BackgroundShellCompletion,
  BackgroundShellResultNotification
} from '../../shared/types'
import {
  type BackgroundResultDeliveryDependencies,
  routeBackgroundResult
} from './backgroundResultDelivery'

export interface DeliverBackgroundShellInput {
  completion: BackgroundShellCompletion
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
  send: (notification: BackgroundShellResultNotification) => void
}

const renderResultPrompt = (completion: BackgroundShellCompletion): string => {
  const error = completion.error?.slice(0, 300)
  return [
    'A background shell command has finished.',
    `- Job ID: ${completion.jobId}`,
    `- Status: ${completion.status}`,
    `- Command: ${completion.command}`,
    completion.exitCode !== undefined ? `- Exit code: ${completion.exitCode ?? 'none'}` : '',
    completion.signal ? `- Signal: ${completion.signal}` : '',
    completion.totalOutputChars !== undefined
      ? `- Output: ${completion.totalOutputChars} chars / ${completion.totalOutputLines || 0} lines`
      : '',
    completion.resourceId ? `- Resource ID: ${completion.resourceId}` : '',
    error ? `- Error summary: ${error}` : '',
    completion.resourceId
      ? `Use search_cached_resource/read_cached_resource for full output from ${completion.resourceId}.`
      : `Read the persisted result with background_job_read {"jobId":"${completion.jobId}"}.`,
    'Do not poll, repeat, or restart the command.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function deliverBackgroundShellResult(
  input: DeliverBackgroundShellInput,
  dependencies?: BackgroundResultDeliveryDependencies
): BackgroundShellResultNotification {
  const route = routeBackgroundResult(
    {
      jobId: input.completion.jobId,
      promptText: renderResultPrompt(input.completion),
      sessionId: input.sessionId,
      contextEpoch: input.contextEpoch
    },
    dependencies
  )
  const notification: BackgroundShellResultNotification = {
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
