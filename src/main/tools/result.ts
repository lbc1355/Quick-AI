import { ToolResultUi } from '../../shared/types'
import { ToolExecutionResult, ToolModelAttachment } from './types'

export const DEFAULT_TOOL_RESULT_UI_DETAILS_LIMIT = 96 * 1024

export interface CreateToolResultOptions {
  resultForModel: string
  title?: string
  summary?: string
  url?: string
  details?: string
  items?: ToolResultUi['items']
  modelAttachments?: ToolModelAttachment[]
  includeModelResultInDetails?: boolean
  callId?: string
  detailsLimit?: number
}

const compact = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const summarizeToolResult = (text: string, maxLength = 220): string => {
  const clean = compact(text)
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(0, maxLength - 1))}…`
}

export const buildToolResultUiDetails = (
  details: string,
  options: { callId?: string; limit?: number } = {}
): string => {
  const limit = options.limit ?? DEFAULT_TOOL_RESULT_UI_DETAILS_LIMIT
  if (details.length <= limit) return details

  const suffix = options.callId
    ? `完整输出 ID: ${options.callId}。需要完整内容时，可以让 agent 读取完整工具输出。`
    : '需要完整内容时，可以让 agent 读取完整工具输出。'

  return `${details.slice(0, limit)}

[界面预览已在 ${limit} 字符处截断。${suffix}]`
}

export function buildToolResultUi(options: CreateToolResultOptions): ToolResultUi {
  const fallbackSummary = summarizeToolResult(options.resultForModel)
  const rawDetails =
    options.details ??
    (options.includeModelResultInDetails === false ? undefined : options.resultForModel)

  return {
    title: options.title,
    url: options.url,
    summary: options.summary || fallbackSummary,
    details: rawDetails
      ? buildToolResultUiDetails(rawDetails, {
          callId: options.callId,
          limit: options.detailsLimit
        })
      : undefined,
    items: options.items
  }
}

export function createToolResult(options: CreateToolResultOptions): ToolExecutionResult {
  return {
    resultForModel: options.resultForModel,
    resultForUi: buildToolResultUi(options),
    modelAttachments: options.modelAttachments
  }
}

export function normalizeToolExecutionResult(
  result: ToolExecutionResult,
  callId?: string
): ToolExecutionResult {
  if (result.resultForUi.details && result.resultForUi.details.trim()) {
    return result
  }

  if (!result.resultForModel.trim()) {
    return result
  }

  return {
    ...result,
    resultForUi: {
      ...result.resultForUi,
      details: buildToolResultUiDetails(result.resultForModel, { callId })
    }
  }
}
