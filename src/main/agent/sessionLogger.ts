import { join } from 'path'
import { existsSync, appendFileSync, mkdirSync } from 'fs'
import { getLogsRoot } from '../paths'
import {
  CachePriorityRetainedRunRef,
  CacheShapeDiagnostics,
  ChatCompletionMessage,
  ChatToolDeclaration,
  ContextRetentionMode,
  PromptCacheStats
} from '../../shared/types'
import { estimateMessagesTokens, estimateTokens } from '../../shared/tokenEstimator'
import { formatTimestamp } from '../logger'

export interface SessionLoggerStartOptions {
  model: string
  apiUrl: string
  skillName?: string
  messages: ChatCompletionMessage[]
  contextRetentionMode?: ContextRetentionMode
  cachePriorityRetainedRuns?: CachePriorityRetainedRunRef[]
  contextWindowTokens?: number
  initialActiveTools?: string[]
}

export interface SessionLoggerModelRequestOptions {
  step: number
  messages: ChatCompletionMessage[]
  toolsToDeclare?: ChatToolDeclaration[]
  contextWindowTokens: number
  cacheDiagnostics?: CacheShapeDiagnostics
}

const PREVIEW_LIMIT = 120

interface ContextAuditMessage {
  index: number
  role: string
  chars: number
  estimatedTokens: number
  toolCallCount: number
  toolRefs: string[]
  preview: string
}

interface ContextAudit {
  messageCount: number
  roleCounts: Record<string, number>
  roleSequence: string[]
  contentChars: number
  estimatedTokens: number
  messages: ContextAuditMessage[]
}

interface UsagePayload {
  hasCacheStats: boolean
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  hitRate?: number
  cacheDiagnostics?: CacheShapeDiagnostics
}

const formatNumber = (value: number | undefined): string =>
  value !== undefined && Number.isFinite(value) ? value.toLocaleString() : 'n/a'

const getMessageContentString = (message: ChatCompletionMessage): string => {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) return JSON.stringify(message.content)
  return ''
}

const truncate = (value: string, max = PREVIEW_LIMIT): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 3))}...` : normalized
}

const summarizeToolRefs = (message: ChatCompletionMessage): string[] => {
  if (message.role === 'tool') {
    return [[message.name, message.tool_call_id].filter(Boolean).join(':')].filter(Boolean)
  }
  return (message.tool_calls || []).map((toolCall) => `${toolCall.function.name}:${toolCall.id}`)
}

const summarizeRoleSequence = (messages: ChatCompletionMessage[]): string[] =>
  messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return `assistant(tool_calls:${message.tool_calls.length})`
    }
    return message.role
  })

const formatRoleCounts = (messages: ChatCompletionMessage[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const message of messages) {
    counts[message.role] = (counts[message.role] || 0) + 1
  }
  return counts
}

const buildContextAudit = (messages: ChatCompletionMessage[]): ContextAudit => {
  const totalChars = messages.reduce(
    (sum, message) => sum + getMessageContentString(message).length,
    0
  )
  return {
    messageCount: messages.length,
    roleCounts: formatRoleCounts(messages),
    roleSequence: summarizeRoleSequence(messages),
    contentChars: totalChars,
    estimatedTokens: estimateMessagesTokens(messages),
    messages: messages.map((message, index) => {
      const content = getMessageContentString(message)
      return {
        index,
        role: message.role,
        chars: content.length,
        estimatedTokens: estimateTokens(content),
        toolCallCount: message.tool_calls?.length || 0,
        toolRefs: summarizeToolRefs(message),
        preview: truncate(content)
      }
    })
  }
}

const buildUsagePayload = (stats: PromptCacheStats | undefined): UsagePayload | undefined => {
  if (!stats) return undefined
  return {
    hasCacheStats: stats.hasCacheStats !== false,
    promptTokens: stats.promptTokens,
    completionTokens: stats.completionTokens,
    totalTokens: stats.totalTokens,
    reasoningTokens: stats.reasoningTokens,
    cacheHitTokens: stats.cacheHitTokens,
    cacheMissTokens: stats.cacheMissTokens,
    hitRate: stats.hitRate,
    cacheDiagnostics: stats.cacheDiagnostics
  }
}

export class SessionLogger {
  private static getSessionLogPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(getLogsRoot(), `session-${safeId}.md`)
  }

  private static getSessionJsonlPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(getLogsRoot(), `session-${safeId}.jsonl`)
  }

  private static append(sessionId: string, markdown: string): void {
    try {
      const path = this.getSessionLogPath(sessionId)
      const dir = join(path, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const isNew = !existsSync(path)
      let content = ''
      if (isNew) {
        content += `# Session Debug Log: ${sessionId}\n\n`
      }
      content += markdown + '\n'
      appendFileSync(path, content, 'utf8')
    } catch (err) {
      console.warn(`Failed to write session log for ${sessionId}:`, (err as Error).message)
    }
  }

  private static appendJsonl(sessionId: string, event: Record<string, unknown>): void {
    try {
      const path = this.getSessionJsonlPath(sessionId)
      const dir = join(path, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
    } catch (err) {
      console.warn(
        `Failed to write structured session log for ${sessionId}:`,
        (err as Error).message
      )
    }
  }

  private static eventBase(sessionId: string, type: string): Record<string, unknown> {
    return {
      type,
      sessionId,
      timestamp: new Date().toISOString()
    }
  }

  static logRunStart(sessionId: string, runId: string, options: SessionLoggerStartOptions): void {
    const time = formatTimestamp(new Date())
    const audit = buildContextAudit(options.messages)

    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'run_start'),
      runId,
      model: options.model,
      apiUrl: options.apiUrl,
      mode: options.skillName || 'General Agent',
      contextRetentionMode: options.contextRetentionMode || 'default',
      cachePriorityRetainedRuns: options.cachePriorityRetainedRuns || [],
      contextWindowTokens: options.contextWindowTokens,
      initialActiveTools: options.initialActiveTools || [],
      context: audit
    })

    const md = `
## [${time}] Run Started: \`${runId}\`
- **Model**: \`${options.model}\`
- **API URL**: \`${options.apiUrl}\`
- **Mode**: \`${options.skillName || 'General Agent'}\`
- **Context Retention**: \`${options.contextRetentionMode || 'default'}\`
- **Messages**: \`${audit.messageCount}\`
- **Estimated Context Tokens**: \`${formatNumber(audit.estimatedTokens)}\`
- **Structured Log**: \`session-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl\`

---
`
    this.append(sessionId, md)
  }

  static logStepStart(sessionId: string, step: number, maxSteps: number): void {
    const time = formatTimestamp(new Date())
    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'step_start'),
      step,
      maxSteps
    })
    const md = `
### Step ${step} / ${maxSteps} (Timestamp: ${time})
`
    this.append(sessionId, md)
  }

  static logModelRequest(sessionId: string, options: SessionLoggerModelRequestOptions): void {
    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'model_request'),
      step: options.step,
      contextWindowTokens: options.contextWindowTokens,
      declaredTools: options.toolsToDeclare?.map((tool) => tool.function.name) || [],
      cacheDiagnostics: options.cacheDiagnostics,
      context: buildContextAudit(options.messages)
    })
  }

  static logModelResponse(
    sessionId: string,
    response: ChatCompletionMessage,
    cacheStats?: PromptCacheStats
  ): void {
    const time = formatTimestamp(new Date())
    const content = getMessageContentString(response)
    const toolCalls = response.tool_calls || []
    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'model_response'),
      role: response.role,
      contentChars: content.length,
      reasoningChars: response.reasoning_content?.length || 0,
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        argsChars: toolCall.function.arguments.length
      })),
      usage: buildUsagePayload(cacheStats),
      preview: truncate(content)
    })

    let toolCallsStr = '(none)'
    if (toolCalls.length > 0) {
      toolCallsStr = toolCalls.map((tc) => `\`${tc.function.name}\` (${tc.id})`).join(', ')
    }

    const md = `
#### Model Response (Timestamp: ${time})
- **Content chars**: \`${formatNumber(content.length)}\`
- **Reasoning chars**: \`${formatNumber(response.reasoning_content?.length || 0)}\`
- **Tool Calls**: ${toolCallsStr}
- **Usage / Cache**: ${cacheStats ? `prompt ${formatNumber(cacheStats.promptTokens)}, hit ${formatNumber(cacheStats.cacheHitTokens)}, miss ${formatNumber(cacheStats.cacheMissTokens)}, rate ${Number.isFinite(cacheStats.hitRate) ? `${cacheStats.hitRate}%` : 'n/a'}` : 'not returned'}
`
    this.append(sessionId, md)
  }

  static logToolExecution(
    sessionId: string,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    permission: string,
    status: string,
    durationMs: number,
    result: string
  ): void {
    const time = formatTimestamp(new Date())
    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'tool_execution'),
      callId,
      toolName,
      args,
      permission,
      status,
      durationMs,
      outputChars: result.length,
      preview: truncate(result)
    })
    const md = `
#### Tool Execution (Timestamp: ${time})
- **Tool**: \`${toolName}\`
- **Call ID**: \`${callId}\`
- **Status**: \`${status}\`
- **Duration**: \`${durationMs}ms\`
- **Output Size**: \`${result.length}\` characters
`
    this.append(sessionId, md)
  }

  static logRunEnd(sessionId: string, status: string, error?: string): void {
    const time = formatTimestamp(new Date())
    this.appendJsonl(sessionId, {
      ...this.eventBase(sessionId, 'run_end'),
      status,
      error
    })
    const md = `
### Run Finished: \`${status}\` (Timestamp: ${time})
${error ? `- **Error**: \`${error}\`` : ''}

================================================================================
`
    this.append(sessionId, md)
  }
}
