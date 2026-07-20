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
  const status =
    completion.status === 'completed'
      ? '已完成'
      : completion.status === 'cancelled'
        ? '已取消'
        : '失败'
  return [
    '### 后台 Shell 结果（自动消息）',
    `- Job ID：${completion.jobId}`,
    `- 状态：${status}`,
    `- 命令：${completion.command}`,
    completion.exitCode !== undefined ? `- 退出码：${completion.exitCode ?? '无'}` : '',
    completion.signal ? `- 信号：${completion.signal}` : '',
    completion.totalOutputChars !== undefined
      ? `- 输出：${completion.totalOutputChars} 字符 / ${completion.totalOutputLines || 0} 行`
      : '',
    completion.resourceId ? `- Resource ID：${completion.resourceId}` : '',
    completion.output ? `\n输出摘要：\n${completion.output}` : '',
    completion.error ? `\n错误：\n${completion.error}` : '',
    completion.resourceId
      ? `\n如摘要不足，请用 search_cached_resource 或 read_cached_resource 查询 Resource ID ${completion.resourceId}；不要重新执行或轮询该命令。`
      : '\n请在下一次回复中使用这个结果，不要重复执行或轮询该命令。'
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
  input.send(notification)
  return notification
}
