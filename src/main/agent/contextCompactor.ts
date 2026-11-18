import {
  ChatCompletionMessage,
  ContextCompactionRequest,
  ContextCompactionResult,
  Message
} from '../../shared/types'
import { callModel } from './callModel'
import { estimateTokens } from './tokenEstimator'
import { sliceUnicode } from '../../shared/unicodeText'

export const DEFAULT_COMPACTION_KEEP_RECENT_MESSAGES = 6

const MAX_MESSAGE_CHARS = 12000
const MAX_TRANSCRIPT_CHARS = 180000

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').trim()

const truncateText = (value: string, maxChars: number): string => {
  const text = normalizeText(value)
  if (text.length <= maxChars) return text
  return `${sliceUnicode(text, 0, Math.max(0, maxChars - 80)).trimEnd()}\n[... truncated ${text.length - maxChars} chars ...]`
}

const stringifyAgentEvents = (message: Message): string => {
  const events = message.agentEvents || []
  if (events.length === 0) return ''

  const toolNames = Array.from(
    new Set(
      events
        .map((event) => {
          const record = event as unknown as Record<string, unknown>
          return String(record.toolName || record.name || record.tool || '').trim()
        })
        .filter(Boolean)
    )
  ).slice(0, 12)

  const eventTypes = Array.from(new Set(events.map((event) => event.type))).slice(0, 12)
  return [
    `agent_events: ${events.length}`,
    eventTypes.length > 0 ? `event_types: ${eventTypes.join(', ')}` : '',
    toolNames.length > 0 ? `tools: ${toolNames.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const stringifyFiles = (message: Message): string => {
  const files = message.files || []
  if (files.length === 0) return ''
  return files
    .map((file) => {
      const content =
        file.type === 'image'
          ? `[image attachment omitted from compaction prompt: ${file.name}]`
          : truncateText(file.content, 1600)
      return `attachment: ${file.name} (${file.type})\n${content}`
    })
    .join('\n\n')
}

const buildCompactionMessageContent = (message: Message): string =>
  [
    message.content ? truncateText(message.content, MAX_MESSAGE_CHARS) : '',
    stringifyFiles(message),
    stringifyAgentEvents(message)
  ]
    .filter(Boolean)
    .join('\n\n')

export function buildCompactionTranscript(messages: Message[]): string {
  const blocks: string[] = []
  let totalChars = 0

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    const parts = [
      `<message index="${index + 1}" role="${message.role}">`,
      message.content ? truncateText(message.content, MAX_MESSAGE_CHARS) : '',
      stringifyFiles(message),
      stringifyAgentEvents(message),
      message.tokenSpeed !== undefined ? `token_speed: ${message.tokenSpeed} token/s` : '',
      '</message>'
    ].filter(Boolean)

    const block = parts.join('\n')
    if (totalChars + block.length > MAX_TRANSCRIPT_CHARS) {
      blocks.push(
        `[... older transcript exceeded ${MAX_TRANSCRIPT_CHARS} chars and was omitted from the compaction prompt ...]`
      )
      break
    }
    blocks.push(block)
    totalChars += block.length
  }

  return blocks.join('\n\n')
}

export async function compactContextWithModel(
  request: ContextCompactionRequest,
  dependencies: {
    callModel?: typeof callModel
    now?: () => number
    signal?: AbortSignal
  } = {}
): Promise<ContextCompactionResult> {
  const keepRecentMessages = request.keepRecentMessages ?? DEFAULT_COMPACTION_KEEP_RECENT_MESSAGES
  const compactedCount = Math.max(0, request.messages.length - keepRecentMessages)
  if (compactedCount < 2) {
    throw new Error('当前对话可压缩内容不足。')
  }

  const COMPACTION_USER_PROMPT_IN_LINE = `【系统指令：请根据以上对话历史，进行上下文压缩和摘要】

你是一个上下文压缩助手。请根据上面的全部对话历史，压缩并生成一条可继续工作的上下文摘要。
要求：
- 保留用户目标、明确偏好、已经做过的代码改动、关键文件路径、命令、错误、测试结果、工具结论、待办与风险。
- 去掉寒暄、重复推理、已经失效的细节。
- 最近消息会原样保留在摘要后面，所以不需要复述最近的消息。
- 请直接输出 Markdown 格式的摘要，使用以下结构，并保持小标题完全一致：

## 上下文摘要
## 已完成
## 当前状态
## 关键事实与约束
## 待办与风险

请直接开始输出，不要包含任何多余的前言、解释或对话句式。`

  const callModelFn = dependencies.callModel || callModel
  const oldMessages = request.messages.slice(0, compactedCount)

  const messages: ChatCompletionMessage[] = []
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt })
  }

  oldMessages.forEach((msg) => {
    if (msg.isRuntimeError) return
    messages.push({ role: msg.role, content: buildCompactionMessageContent(msg) })
  })

  messages.push({
    role: 'user',
    content: COMPACTION_USER_PROMPT_IN_LINE
  })

  let streamed = ''
  const start = dependencies.now?.() ?? Date.now()
  const assistant = await callModelFn(
    {
      apiUrl: request.apiUrl,
      apiKey: request.apiKey,
      providerConnection: request.providerConnection,
      model: request.model,
      modelRuntime: request.modelRuntime,
      // Compaction should stay cheap; never inherit session max/high effort.
      reasoningPreference: 'auto'
    },
    messages,
    undefined,
    dependencies.signal,
    {
      onReasoning: () => {},
      onFinalChunk: (chunk) => {
        streamed += chunk
      }
    }
  )
  const end = dependencies.now?.() ?? Date.now()
  const summary =
    (typeof assistant.content === 'string' ? assistant.content : '') || streamed.trim()
  const cleanSummary = normalizeText(summary)
  if (!cleanSummary) {
    throw new Error('模型没有返回可用的上下文摘要。')
  }

  const outputTokens = estimateTokens(cleanSummary)
  const durationSec = Math.max(0, (end - start) / 1000)

  return {
    summary: cleanSummary,
    compactedCount,
    keptCount: request.messages.length - compactedCount,
    tokenSpeed: durationSec > 0 ? Number((outputTokens / durationSec).toFixed(1)) : undefined
  }
}
