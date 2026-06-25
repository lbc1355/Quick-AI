import { AgentEvent, ChatCompletionMessage, SessionResource } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext, ToolModelAttachment } from '../tools/types'
import { ToolRegistryView } from '../tools/registryView'
import { ActionLog } from './actionLog'
import {
  FetchUrlBudget,
  PreparedToolExecutionResult,
  executePreparedToolCall
} from './preparedToolExecutor'
import { RetryPolicy } from './retryPolicy'
import { AmbiguousAction } from './runCheckpoint'
import { ExecuteToolForStep } from './toolStepProcessor'
import { PreparedToolCall } from './toolCallPlanning'
import { ToolRuntimeLoopGuard } from './toolRuntime'
import { RecordToolActionOptions, recordToolAction } from './toolActionRecorder'

export interface CreateToolStepExecutorOptions {
  toolRegistry: ToolRegistryView
  reqId: string
  conversationId: string
  step: number
  maxSteps: number
  stepId: string
  signal: AbortSignal
  retryPolicy: RetryPolicy
  isSideEffecting: (toolName: string) => boolean
  loopGuard: ToolRuntimeLoopGuard
  outputSpilloverThreshold: number
  activeTools: Set<string>
  fetchUrlBudget: FetchUrlBudget
  toolModelAttachments: Array<ToolModelAttachment[] | undefined>
  actionLog: ActionLog
  markExecuted: (callKey: string) => void
  storeToolOutput: (callId: string, text: string) => void
  activateTool: (toolName: string) => void
  onHaltRequested: () => void
  onAmbiguousAction: (action: AmbiguousAction) => void
  resources?: SessionResource[]
  agentModel?: ToolExecutionContext['agentModel']
  mainWindow?: Parameters<ToolDefinition['execute']>[1]['mainWindow']
  emitEvent?: (event: AgentEvent) => void
  executePreparedToolCall?: typeof executePreparedToolCall
  recordToolAction?: typeof recordToolAction
}

export function createToolStepExecutor(options: CreateToolStepExecutorOptions): ExecuteToolForStep {
  const runPreparedTool = options.executePreparedToolCall || executePreparedToolCall
  const recordAction = options.recordToolAction || recordToolAction

  return async (
    prep: PreparedToolCall,
    isApproved: boolean,
    emitToolEvents: (events: AgentEvent[]) => void
  ): Promise<ChatCompletionMessage> => {
    const { toolName } = prep
    const toolStartTime = Date.now()

    const executionResult: PreparedToolExecutionResult = await runPreparedTool({
      prep,
      tool: options.toolRegistry.get(toolName),
      isApproved,
      reqId: options.reqId,
      step: options.step,
      maxSteps: options.maxSteps,
      stepId: options.stepId,
      signal: options.signal,
      mainWindow: options.mainWindow,
      resources: options.resources,
      agentModel: options.agentModel,
      retryPolicy: options.retryPolicy,
      isSideEffecting: options.isSideEffecting(toolName),
      loopGuard: options.loopGuard,
      outputSpilloverThreshold: options.outputSpilloverThreshold,
      activeTools: Array.from(options.activeTools),
      fetchUrlBudget: options.fetchUrlBudget,
      emitEvent: options.emitEvent
    })

    if (executionResult.modelAttachments && executionResult.modelAttachments.length > 0) {
      options.toolModelAttachments[prep.index] = executionResult.modelAttachments
    }

    if (executionResult.markExecutedCallKey) {
      options.markExecuted(executionResult.markExecutedCallKey)
    }

    if (executionResult.outputStore) {
      options.storeToolOutput(
        executionResult.outputStore.callId,
        executionResult.outputStore.content
      )
      const toolNames = executionResult.outputStore.activateToolNames ?? [
        executionResult.outputStore.activateToolName
      ]
      for (const toolName of toolNames) {
        options.activateTool(toolName)
      }
    }

    emitToolEvents(executionResult.events)

    if (executionResult.haltRequested) {
      options.onHaltRequested()
    }

    if (executionResult.ambiguousAction) {
      options.onAmbiguousAction(executionResult.ambiguousAction)
    }

    recordAction({
      actionLog: options.actionLog,
      conversationId: options.conversationId,
      reqId: options.reqId,
      turnIndex: options.step,
      callId: prep.callId,
      toolName: prep.toolName,
      args: prep.args,
      permission: prep.permission,
      status: executionResult.action.resultStatus,
      resultContent: executionResult.action.resultContent,
      outputSpilloverThreshold: options.outputSpilloverThreshold,
      startedAt: toolStartTime
    } satisfies RecordToolActionOptions)

    return executionResult.response
  }
}
