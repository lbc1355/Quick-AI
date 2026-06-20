import { AgentEvent, ChatCompletionMessage, ToolArgs } from '../../shared/types'
import {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolModelAttachment
} from '../tools/types'
import { createToolResult, normalizeToolExecutionResult } from '../tools/result'
import { RetryPolicy, isRetryableError, withRetry } from './retryPolicy'

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

export interface ExecuteRuntimeToolCallOptions {
  toolName: string
  callId: string
  args: ToolArgs
  tool: ToolDefinition
  context: ToolExecutionContext
  retryPolicy: RetryPolicy
  isSideEffecting: boolean
}

export interface ToolRuntimeCallResult {
  status: 'success' | ToolRuntimeFailureStatus
  response: ChatCompletionMessage
  executionResult: ToolExecutionResult
  modelAttachments?: ToolModelAttachment[]
  errorMessage?: string
  errorContent?: string
}

export interface ToolRuntimeLoopGuard {
  recordSuccess(toolName: string): void
  recordFailure(toolName: string): { level: 'ok' | 'warn' | 'halt'; count: number }
}

export interface ApplyRuntimeToolCallResultOptions {
  runtimeResult: ToolRuntimeCallResult
  toolName: string
  callId: string
  args: ToolArgs
  loopGuard: ToolRuntimeLoopGuard
  outputSpilloverThreshold: number
  fetchUrlCallKey?: string | null
  step: number
  maxSteps: number
  stepId: string
  activeTools: string[]
  now?: number
}

export interface RuntimeToolActionDraft {
  resultStatus: 'success' | 'error' | 'ambiguous'
  resultContent: string
}

export interface RuntimeToolOutputStoreRequest {
  callId: string
  content: string
  activateToolName: 'read_tool_output'
}

export interface RuntimeToolAmbiguousActionDraft {
  callId: string
  toolName: string
  args: ToolArgs
  reason: string
  timestamp: number
}

export interface AppliedRuntimeToolCallResult {
  response: ChatCompletionMessage
  events: AgentEvent[]
  action: RuntimeToolActionDraft
  haltRequested: boolean
  modelAttachments?: ToolModelAttachment[]
  markExecutedCallKey?: string
  outputStore?: RuntimeToolOutputStoreRequest
  ambiguousAction?: RuntimeToolAmbiguousActionDraft
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

export function applyRuntimeToolCallResult(
  options: ApplyRuntimeToolCallResultOptions
): AppliedRuntimeToolCallResult {
  const { runtimeResult, toolName, callId, step, stepId } = options
  const { resultForModel, resultForUi, modelAttachments } = runtimeResult.executionResult

  if (runtimeResult.status === 'success') {
    options.loopGuard.recordSuccess(toolName)
    const outputStore =
      resultForModel.length > options.outputSpilloverThreshold
        ? {
            callId,
            content: resultForModel,
            activateToolName: 'read_tool_output' as const
          }
        : undefined
    const activeTools = outputStore
      ? Array.from(new Set([...options.activeTools, outputStore.activateToolName]))
      : options.activeTools

    return {
      response: runtimeResult.response,
      events: [
        {
          type: 'tool_result',
          callId,
          result: resultForUi,
          step,
          stepId
        },
        {
          type: 'agent_progress',
          step,
          maxSteps: options.maxSteps,
          stepId,
          activeTools,
          message: `Completed ${toolName}`
        }
      ],
      action: {
        resultStatus: 'success',
        resultContent: resultForModel
      },
      haltRequested: false,
      modelAttachments,
      markExecutedCallKey: options.fetchUrlCallKey || undefined,
      outputStore
    }
  }

  const failure = options.loopGuard.recordFailure(toolName)
  let guardNote = ''
  let haltRequested = false
  if (failure.level === 'halt') {
    haltRequested = true
    guardNote = ` [Loop guard: "${toolName}" failed ${failure.count} times in a row; halting tool use and forcing a final answer.]`
  } else if (failure.level === 'warn') {
    guardNote = ` [Loop guard: "${toolName}" has failed ${failure.count} times in a row; try a different approach or tool.]`
  }

  const resultContent = `${runtimeResult.errorContent || resultForModel}${guardNote}`
  const ambiguousAction =
    runtimeResult.status === 'ambiguous'
      ? {
          callId,
          toolName,
          args: options.args,
          reason: resultContent,
          timestamp: options.now ?? Date.now()
        }
      : undefined

  return {
    response: {
      ...runtimeResult.response,
      content: resultContent
    },
    events: [
      {
        type: 'tool_result',
        callId,
        result: resultForUi,
        step,
        stepId
      },
      {
        type: 'tool_error',
        callId,
        error: runtimeResult.errorMessage || resultContent,
        step,
        stepId
      }
    ],
    action: {
      resultStatus: runtimeResult.status,
      resultContent
    },
    haltRequested,
    ambiguousAction
  }
}

export async function executeRuntimeToolCall(
  options: ExecuteRuntimeToolCallOptions
): Promise<ToolRuntimeCallResult> {
  try {
    if (options.context.signal.aborted) {
      throw new Error('Agent execution aborted by user.')
    }

    const rawResult = await withRetry(
      () => options.tool.execute(options.args, options.context),
      options.retryPolicy,
      options.context.signal
    )
    const executionResult = normalizeToolExecutionResult(rawResult, options.callId)

    if (options.context.signal.aborted) {
      throw new Error('Agent execution aborted by user.')
    }

    return {
      status: 'success',
      executionResult,
      modelAttachments: executionResult.modelAttachments,
      response: {
        role: 'tool',
        tool_call_id: options.callId,
        name: options.toolName,
        content: executionResult.resultForModel
      }
    }
  } catch (error) {
    const err = error as Error
    const classification = classifyToolRuntimeError(err, {
      signal: options.context.signal,
      isSideEffecting: options.isSideEffecting,
      retryable: isRetryableError(err, options.retryPolicy)
    })
    const errorContent = `${classification.category} ${err.message}`
    const executionResult = createToolFailureExecutionResult({
      toolName: options.toolName,
      args: options.args,
      errorMessage: err.message,
      errorContent,
      status: classification.status
    })

    return {
      status: classification.status,
      executionResult,
      errorMessage: err.message,
      errorContent,
      response: {
        role: 'tool',
        tool_call_id: options.callId,
        name: options.toolName,
        content: errorContent
      }
    }
  }
}
