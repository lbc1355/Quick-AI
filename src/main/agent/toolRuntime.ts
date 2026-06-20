import { ToolArgs } from '../../shared/types'
import { ToolExecutionResult } from '../tools/types'
import { createToolResult } from '../tools/result'

export type ToolRuntimeFailureStatus = 'error' | 'ambiguous'

export interface ToolRuntimeErrorClassification {
  interrupted: boolean
  status: ToolRuntimeFailureStatus
  category: string
}

export interface ClassifyToolRuntimeErrorOptions {
  signal?: AbortSignal
  isSideEffecting: boolean
  retryable: boolean
}

export interface CreateToolFailureExecutionResultOptions {
  toolName: string
  args: ToolArgs
  errorMessage: string
  errorContent: string
  status: ToolRuntimeFailureStatus
}

const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue: unknown) => {
        if (typeof nestedValue === 'bigint') return nestedValue.toString()
        if (typeof nestedValue !== 'object' || nestedValue === null) return nestedValue
        if (seen.has(nestedValue)) return '[Circular]'
        seen.add(nestedValue)
        return nestedValue
      },
      2
    )
  } catch {
    return String(value)
  }
}

export function classifyToolRuntimeError(
  error: Error,
  options: ClassifyToolRuntimeErrorOptions
): ToolRuntimeErrorClassification {
  const message = error.message || ''
  const interrupted =
    !!options.signal?.aborted ||
    error.name === 'AbortError' ||
    message.toLowerCase().includes('aborted') ||
    message.toLowerCase().includes('cancelled')

  if (options.isSideEffecting && interrupted) {
    return {
      interrupted,
      status: 'ambiguous',
      category: '[Ambiguous Side Effect - inspect state before repeating]'
    }
  }

  if (options.retryable) {
    return {
      interrupted,
      status: 'error',
      category: '[Transient Error - retries exhausted]'
    }
  }

  return {
    interrupted,
    status: 'error',
    category: '[Permanent Error - do not retry this action]'
  }
}

export function createToolFailureExecutionResult(
  options: CreateToolFailureExecutionResultOptions
): ToolExecutionResult {
  const argsJson = safeJsonStringify(options.args)
  const details = [
    `Tool: ${options.toolName}`,
    `Status: ${options.status}`,
    `Error: ${options.errorMessage}`,
    argsJson ? `Arguments:\n${argsJson}` : '',
    options.errorContent && options.errorContent !== options.errorMessage
      ? `Model Observation:\n${options.errorContent}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return createToolResult({
    resultForModel: options.errorContent,
    title: `Tool Failed: ${options.toolName}`,
    summary: options.errorMessage,
    details
  })
}
