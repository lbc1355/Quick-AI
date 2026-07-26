import type { Message, RunMode } from '../../../../shared/types'

export interface AttachedFile {
  name: string
  content: string
  type: string
}

export const createUserMessage = (input: {
  id: string
  content: string
  files?: AttachedFile[]
}): Message => ({
  id: input.id,
  role: 'user',
  content: input.content,
  files: [...(input.files || [])]
})

/**
 * The empty assistant bubble a run streams into.
 *
 * Agent runs additionally carry run ids and an event array so the timeline can render steps as
 * they arrive; chat runs stay minimal so the bubble is not mistaken for an agent run by the
 * view model's status inference.
 */
export const createAssistantPlaceholder = (input: {
  id: string
  runMode: RunMode
  runId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}): Message => ({
  id: input.id,
  role: 'assistant',
  content: '',
  reasoning_content: '',
  ...(input.runMode === 'agent' && input.runId
    ? { agentRunId: input.runId, agentRunIds: [input.runId], agentEvents: [] }
    : {}),
  ...(input.branchOf ? { isBranchFork: true, forkedFrom: input.branchOf } : {})
})

/** Placeholder shown for a prompt that was admitted to the inbox while a run was in flight. */
export const createQueuedAssistantPlaceholder = (id: string): Message => ({
  id,
  role: 'assistant',
  content: '⏳ 已加入队列',
  reasoning_content: ''
})

export const markMessageAsRuntimeError = (message: Message, content: string): Message => ({
  ...message,
  content,
  isRuntimeError: true
})

export const HELP_MESSAGE_CONTENT = `### QuickAI 快捷操作与命令

* **全局快捷键**：\`Alt + /\`（显示或隐藏）
* **快速隐藏**：\`Esc\`
* **换行**：\`Shift + Enter\`
* **发送消息**：\`Enter\`
* **窗口拖动**：按住顶部标题栏空白区域可移动窗口

#### 可用的 "/" 快捷指令
* \`/new\` - 新建空白对话
* \`/clear\` - 清空当前对话
* \`/settings\` - 打开设置面板
* \`/help\` - 显示帮助信息
* \`/model:模型名\` - 切换模型
* \`/history:会话名\` - 加载历史对话
* \`/delete:会话名\` - 删除历史对话`

export const createHelpMessage = (now: number): Message => ({
  id: `help-${now}`,
  role: 'assistant',
  content: HELP_MESSAGE_CONTENT
})
