import { AgentEvent, ChatCompletionMessage, SessionResource } from '../../shared/types'
import { ToolDefinition, ToolModelAttachment } from '../tools/types'
import { ActionLog } from './actionLog'
import { AgentToolDiscovery } from './agentRunPreparation'
import { FetchUrlBudget } from './preparedToolExecutor'
import { RetryPolicy } from './retryPolicy'
import { AmbiguousAction } from './runCheckpoint'
import { LoopGuard } from './loopGuard'
import {
  ToolPermission,
  prepareToolCalls as defaultPrepareToolCalls
} from './toolCallPlanning'
import {
  buildAgentStepPresentation as defaultBuildAgentStepPresentation
} from './toolStepPresentation'
import {
  createToolStepExecutor as defaultCreateToolStepExecutor
} from './toolStepApplicator'
import {
  processPreparedToolStep as defaultProcessPreparedToolStep
} from './toolStepProcessor'

export interface ToolTurnRunContext {
  activeTools: Set<string>
  actionLog: ActionLog
  projectRoot?: string
  isToolActive: (toolName: string) => boolean
  isToolApproved: (toolName: string) => boolean
  isCommandPrefixApproved: (command: string) => boolean
  hasExecuted: (callKey: string) => boolean
  markExecuted: (callKey: string) => void
  storeToolOutput: (callId: string, text: string) => void
  activateTool: (toolName: string) => void
}

export interface RunToolTurnDependencies {
  prepareToolCalls?: typeof defaultPrepareToolCalls
  buildAgentStepPresentation?: typeof defaultBuildAgentStepPresentation
  createToolStepExecutor?: typeof defaultCreateToolStepExecutor
  processPreparedToolStep?: typeof defaultProcessPreparedToolStep
}

export interface RunToolTurnOptions {
  assistantMessage: ChatCompletionMessage
  assistantTextBuffer: string
  toolDiscovery: AgentToolDiscovery
  skillTools: string[]
  permissions?: Record<string, ToolPermission>
  reqId: string
  conversationId: string
  step: number
  maxSteps: number
  stepId: string
  signal: AbortSignal
  resources?: SessionResource[]
  retryPolicy: RetryPolicy
  isSideEffecting: (toolName: string) => boolean
  loopGuard: LoopGuard
  outputSpilloverThreshold: number
  fetchUrlBudget: FetchUrlBudget
  toolRegistry: Record<string, ToolDefinition | undefined>
  runContext: ToolTurnRunContext
  emitEvent: (event: AgentEvent) => void
  requestPermission: (callId: string) => Promise<boolean>
  mainWindow?: Parameters<ToolDefinition['execute']>[1]['mainWindow']
  dependencies?: RunToolTurnDependencies
}

export interface RunToolTurnResult {
  messagesToAppend: ChatCompletionMessage[]
  lastRecordedCallId?: string
  haltRequested: boolean
  ambiguousActions: AmbiguousAction[]
}

const getAssistantText = (content: ChatCompletionMessage['content']): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

export async function runToolTurn(options: RunToolTurnOptions): Promise<RunToolTurnResult> {
  const prepareToolCalls = options.dependencies?.prepareToolCalls || defaultPrepareToolCalls
  const buildAgentStepPresentation =
    options.dependencies?.buildAgentStepPresentation || defaultBuildAgentStepPresentation
  const createToolStepExecutor =
    options.dependencies?.createToolStepExecutor || defaultCreateToolStepExecutor
  const processPreparedToolStep =
    options.dependencies?.processPreparedToolStep || defaultProcessPreparedToolStep

  const toolCalls = options.assistantMessage.tool_calls || []
  const isToolWhitelisted = (toolName: string): boolean =>
    options.toolDiscovery === 'static'
      ? options.skillTools.includes(toolName)
      : options.runContext.isToolActive(toolName)

  const { askCalls, directCalls, blockedCalls } = prepareToolCalls({
    toolCalls,
    permissions: options.permissions,
    isToolWhitelisted,
    isToolApproved: (toolName) => options.runContext.isToolApproved(toolName),
    isCommandPrefixApproved: (command) => options.runContext.isCommandPrefixApproved(command),
    hasExecuted: (callKey) => options.runContext.hasExecuted(callKey),
    loopGuard: options.loopGuard,
    projectRoot: options.runContext.projectRoot
  })

  const preparedCalls = [...askCalls, ...directCalls, ...blockedCalls].sort(
    (a, b) => a.index - b.index
  )
  const assistantStepText =
    getAssistantText(options.assistantMessage.content) || options.assistantTextBuffer
  const stepPresentation = buildAgentStepPresentation(assistantStepText, preparedCalls)
  const toolModelAttachments = new Array<ToolModelAttachment[] | undefined>(toolCalls.length)
  let haltRequested = false
  const ambiguousActions: AmbiguousAction[] = []

  const executeTool = createToolStepExecutor({
    toolRegistry: options.toolRegistry,
    reqId: options.reqId,
    conversationId: options.conversationId,
    step: options.step,
    maxSteps: options.maxSteps,
    stepId: options.stepId,
    signal: options.signal,
    mainWindow: options.mainWindow,
    resources: options.resources,
    retryPolicy: options.retryPolicy,
    isSideEffecting: (toolName) => options.isSideEffecting(toolName),
    loopGuard: options.loopGuard,
    outputSpilloverThreshold: options.outputSpilloverThreshold,
    activeTools: options.runContext.activeTools,
    fetchUrlBudget: options.fetchUrlBudget,
    toolModelAttachments,
    actionLog: options.runContext.actionLog,
    markExecuted: (callKey) => options.runContext.markExecuted(callKey),
    storeToolOutput: (callId, text) => options.runContext.storeToolOutput(callId, text),
    activateTool: (toolName) => options.runContext.activateTool(toolName),
    onHaltRequested: () => {
      haltRequested = true
    },
    onAmbiguousAction: (action) => {
      ambiguousActions.push(action)
    },
    emitEvent: options.emitEvent
  })

  const processedStep = await processPreparedToolStep({
    toolCallCount: toolCalls.length,
    preparedCalls,
    askCalls,
    directCalls,
    blockedCalls,
    step: options.step,
    maxSteps: options.maxSteps,
    stepId: options.stepId,
    title: stepPresentation.title,
    message: stepPresentation.message,
    signal: options.signal,
    emitEvent: options.emitEvent,
    requestPermission: options.requestPermission,
    isToolApproved: (toolName) => options.runContext.isToolApproved(toolName),
    isCommandPrefixApproved: (command) => options.runContext.isCommandPrefixApproved(command),
    executeTool,
    toolModelAttachments
  })

  return {
    messagesToAppend: processedStep.messagesToAppend,
    lastRecordedCallId: processedStep.lastRecordedCallId,
    haltRequested,
    ambiguousActions
  }
}
