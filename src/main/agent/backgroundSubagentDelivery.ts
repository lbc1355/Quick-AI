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
  input.send(notification)
  return notification
}
