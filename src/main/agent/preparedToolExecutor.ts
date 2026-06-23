import { AgentEvent, ChatCompletionMessage, SessionResource } from '../../shared/types'
import { ToolDefinition, ToolModelAttachment } from '../tools/types'
import { RetryPolicy } from './retryPolicy'
import { PreparedToolCall, getFetchUrlCallKey } from './toolCallPlanning'
import {
  RuntimeToolActionDraft,
  RuntimeToolAmbiguousActionDraft,
  RuntimeToolOutputStoreRequest,
  ToolRuntimeLoopGuard,
  applyRuntimeToolCallResult,
  createSkippedToolCallResult,
  executeRuntimeToolCall
} from './toolRuntime'
import { persistToolOutputResource } from './toolOutputResource'

const TOOL_OUTPUT_RESOURCE_SPILLOVER_EXCLUDED_TOOLS = new Set([
  'fetch_url',
  'click_link',
  'list_cached_resources',
  'read_cached_resource',
  'search_cached_resource',
  'read_tool_output'
])

const shouldPersistToolOutputResource = (toolName: string): boolean =>
  !TOOL_OUTPUT_RESOURCE_SPILLOVER_EXCLUDED_TOOLS.has(toolName)

export interface FetchUrlBudget {
  count: number
  max: number
}

export interface ExecutePreparedToolCallOptions {
  prep: PreparedToolCall
  tool?: ToolDefinition
  isApproved: boolean
  reqId: string
  step: number
  maxSteps: number
  stepId: string
  signal: AbortSignal
  retryPolicy: RetryPolicy
  isSideEffecting: boolean
  loopGuard: ToolRuntimeLoopGuard
  outputSpilloverThreshold: number
  activeTools: string[]
  fetchUrlBudget: FetchUrlBudget
  resources?: SessionResource[]
  mainWindow?: Parameters<ToolDefinition['execute']>[1]['mainWindow']
  emitEvent?: (event: AgentEvent) => void
}

export interface PreparedToolExecutionResult {
  response: ChatCompletionMessage
  events: AgentEvent[]
  action: RuntimeToolActionDraft
  haltRequested: boolean
  modelAttachments?: ToolModelAttachment[]
  markExecutedCallKey?: string
  outputStore?: RuntimeToolOutputStoreRequest
  ambiguousAction?: RuntimeToolAmbiguousActionDraft
}

const toPreparedResult = (
  skippedResult: ReturnType<typeof createSkippedToolCallResult>
): PreparedToolExecutionResult => ({
  response: skippedResult.response,
  events: skippedResult.events,
  action: skippedResult.action,
  haltRequested: false
})

export async function executePreparedToolCall(
  options: ExecutePreparedToolCallOptions
): Promise<PreparedToolExecutionResult> {
  const { prep, step, stepId } = options
  const { toolName, callId, args: toolArgs } = prep

  if (!prep.isValid || prep.permission === 'deny' || !options.tool) {
    const errorMsg =
      prep.blockReason ||
      `Tool execution blocked: Tool "${toolName}" is not registered, not implemented, not whitelisted/activated, or denied by policy.`
    return toPreparedResult(
      createSkippedToolCallResult({
        toolName,
        callId,
        args: toolArgs,
        modelContent: `Error: ${errorMsg}`,
        toolError: errorMsg,
        actionStatus: 'denied',
        step,
        stepId,
        deniedToolCall: {
          purpose: prep.purpose
        }
      })
    )
  }

  if (prep.isDeadlock) {
    const offset = typeof toolArgs.offset === 'number' ? toolArgs.offset : 0
    const deadlockWarning = `Warning: You have already fetched this URL window: ${toolArgs.url} at offset ${offset}. Use the nextOffset from the previous result to continue.`
    return toPreparedResult(
      createSkippedToolCallResult({
        toolName,
        callId,
        args: toolArgs,
        modelContent: deadlockWarning,
        toolError: deadlockWarning,
        actionStatus: 'blocked',
        step,
        stepId
      })
    )
  }

  if (prep.loopBlock) {
    return toPreparedResult(
      createSkippedToolCallResult({
        toolName,
        callId,
        args: toolArgs,
        modelContent: prep.loopBlock,
        toolError: prep.loopBlock,
        actionStatus: 'blocked',
        step,
        stepId
      })
    )
  }

  if (toolName === 'fetch_url') {
    if (options.fetchUrlBudget.count >= options.fetchUrlBudget.max) {
      const limitWarning = `Warning: You have reached the maximum fetch limit of ${options.fetchUrlBudget.max} page windows for this run. Please summarize based only on the content you already have.`
      return toPreparedResult(
        createSkippedToolCallResult({
          toolName,
          callId,
          args: toolArgs,
          modelContent: limitWarning,
          toolError: limitWarning,
          actionStatus: 'blocked',
          step,
          stepId
        })
      )
    }
    if (options.isApproved) {
      options.fetchUrlBudget.count++
    }
  }

  if (!options.isApproved) {
    const errorMsg = 'Tool execution denied by user.'
    return toPreparedResult(
      createSkippedToolCallResult({
        toolName,
        callId,
        args: toolArgs,
        modelContent: `ERROR: ${errorMsg}`,
        toolError: errorMsg,
        actionStatus: 'denied',
        step,
        stepId
      })
    )
  }

  const runtimeResult = await executeRuntimeToolCall({
    toolName,
    callId,
    args: toolArgs,
    tool: options.tool,
    context: {
      reqId: options.reqId,
      callId,
      signal: options.signal,
      mainWindow: options.mainWindow,
      resources: options.resources,
      emitEvent: options.emitEvent,
      emitOutput: ({ stream, content, replace }) => {
        if (!content) return
        options.emitEvent?.({
          type: 'tool_output_delta',
          callId,
          stream,
          content,
          replace,
          step,
          stepId
        })
      }
    },
    retryPolicy: options.retryPolicy,
    isSideEffecting: options.isSideEffecting
  })

  let toolOutputResource: Awaited<ReturnType<typeof persistToolOutputResource>> | undefined
  if (
    runtimeResult.status === 'success' &&
    shouldPersistToolOutputResource(toolName) &&
    runtimeResult.executionResult.resultForModel.length > options.outputSpilloverThreshold
  ) {
    try {
      toolOutputResource = await persistToolOutputResource({
        reqId: options.reqId,
        callId,
        toolName,
        content: runtimeResult.executionResult.resultForModel,
        previewChars: options.outputSpilloverThreshold,
        emitEvent: options.emitEvent
      })
    } catch (err) {
      console.warn(
        `[toolOutputResource] Failed to persist large output for ${toolName}/${callId}:`,
        (err as Error).message
      )
    }
  }

  return applyRuntimeToolCallResult({
    runtimeResult,
    toolName,
    callId,
    args: toolArgs,
    loopGuard: options.loopGuard,
    outputSpilloverThreshold: options.outputSpilloverThreshold,
    fetchUrlCallKey: toolName === 'fetch_url' ? getFetchUrlCallKey(toolArgs) : undefined,
    step,
    maxSteps: options.maxSteps,
    stepId,
    activeTools: options.activeTools,
    toolOutputResource
  })
}
