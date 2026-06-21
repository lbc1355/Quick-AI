import { createToolResult } from './result'
import { ToolExecutionResult } from './types'

export function createResourceToolResult(options: {
  resultForModel: string
  title: string
  summary: string
}): ToolExecutionResult {
  return createToolResult({
    resultForModel: options.resultForModel,
    title: options.title,
    summary: options.summary
  })
}
