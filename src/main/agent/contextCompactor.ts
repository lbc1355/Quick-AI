import {
  ChatCompletionMessage,
  ContextCompactionRequest,
  ContextCompactionResult,
  Message
} from '../../shared/types'
import { callModel } from './callModel'
import { estimateTokens } from './tokenEstimator'

export const CONTEXT_COMPACTION_SUMMARY_MARKER = 'AI context compaction summary.'
export const DEFAULT_COMPACTION_KEEP_RECENT_MESSAGES = 6

const MAX_MESSAGE_CHARS = 12000
const MAX_TRANSCRIPT_CHARS = 180000

const COMPACTION_SYSTEM_PROMPT = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns are kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the transcript includes a previous compaction summary, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Keep exact file paths, symbols, commands, tool findings, user preferences, open questions, and unfinished tasks when known. Prefer terse bullets over paragraphs.

Do not answer the user's task. Do not mention that you are summarizing or compacting. Respond in the same language as the conversation.`

const COMPACTION_USER_PROMPT = `请将下面的旧对话压缩成一条可继续工作的上下文摘要。

要求：
- 保留用户目标、明确偏好、已经做过的代码改动、关键文件路径、命令、错误、测试结果、工具结论、未完成事项。
- 去掉寒暄、重复推理、已经失效的细节。
- 最近消息会原样保留在摘要后面，所以不要复述最近消息，除非它们对旧上下文的承接很关键。
- 输出 Markdown，使用以下结构：

## 上下文摘要
## 已完成
## 当前状态
## 关键事实与约束
## 待办与风险

<old-conversation>
{{TRANSCRIPT}}
</old-conversation>`

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').trim()

const truncateText = (value: string, maxChars: number): string => {
  const text = normalizeText(value)
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n[... truncated ${text.length - maxChars} chars ...]`
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

export function buildCompactionTranscript(messages: Message[]): string {
  const blocks: string[] = []
  let totalChars = 0

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    const parts = [
      `<message index="${index + 1}" role="${message.role}">`,
      message.content ? truncateText(message.content, MAX_MESSAGE_CHARS) : '',
      message.reasoning_content
        ? `reasoning_summary:\n${truncateText(message.reasoning_content, 2000)}`
        : '',
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
  dependencies: { callModel?: typeof callModel; now?: () => number } = {}
): Promise<ContextCompactionResult> {
  const keepRecentMessages = request.keepRecentMessages ?? DEFAULT_COMPACTION_KEEP_RECENT_MESSAGES
  const compactedCount = Math.max(0, request.messages.length - keepRecentMessages)
  if (compactedCount < 2) {
    throw new Error('当前对话可压缩内容不足。')
  }

  const callModelFn = dependencies.callModel || callModel
  const oldMessages = request.messages.slice(0, compactedCount)
  const transcript = buildCompactionTranscript(oldMessages)
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: COMPACTION_USER_PROMPT.replace('{{TRANSCRIPT}}', transcript)
    }
  ]

  let streamed = ''
  const start = dependencies.now?.() ?? Date.now()
  const assistant = await callModelFn(
    {
      apiUrl: request.apiUrl,
      apiKey: request.apiKey,
      model: request.model,
      modelRuntime: request.modelRuntime
    },
    messages,
    undefined,
    undefined,
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
