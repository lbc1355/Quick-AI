import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { ToolModelAttachment } from '../tools/types'
import { PreparedToolCall } from './toolCallPlanning'
import { runPreparedToolBatch } from './toolBatchRunner'
import { finalizeToolStep } from './toolStepFinalizer'

export type EmitToolEvents = (events: AgentEvent[]) => void

export type ExecuteToolForStep = (
  prep: PreparedToolCall,
  isApproved: boolean,
  emitToolEvents: EmitToolEvents
) => Promise<ChatCompletionMessage>

export interface ProcessPreparedToolStepOptions {
  toolCallCount: number
  preparedCalls: PreparedToolCall[]
  askCalls: PreparedToolCall[]
  directCalls: PreparedToolCall[]
  blockedCalls: PreparedToolCall[]
  step: number
  maxSteps: number
  stepId: string
  title: string
  message: string
  signal: AbortSignal
  emitEvent: (event: AgentEvent) => void
  requestPermission: (callId: string) => Promise<boolean>
  isToolApproved: (toolName: string) => boolean
  isCommandPrefixApproved: (command: string) => boolean
  executeTool: ExecuteToolForStep
  toolModelAttachments: Array<ToolModelAttachment[] | undefined>
}

export interface ProcessPreparedToolStepResult {
  messagesToAppend: ChatCompletionMessage[]
  lastRecordedCallId?: string
  status: 'completed' | 'failed'
}

export async function processPreparedToolStep(
  options: ProcessPreparedToolStepOptions
): Promise<ProcessPreparedToolStepResult> {
  let stepHadToolFailure = false
  const sendToolEvents = (events: AgentEvent[]): void => {
    for (const event of events) {
      if (event.type === 'tool_error') {
        stepHadToolFailure = true
        options.emitEvent({
          ...event,
          step: event.step ?? options.step,
          stepId: event.stepId ?? options.stepId
        })
      } else {
        options.emitEvent(event)
      }
    }
  }

  options.emitEvent({
    type: 'agent_step',
    stepId: options.stepId,
    step: options.step,
    maxSteps: options.maxSteps,
    title: options.title,
    message: options.message,
    status: 'running'
  })

  const { toolResponses } = await runPreparedToolBatch({
    toolCallCount: options.toolCallCount,
    askCalls: options.askCalls,
    directCalls: options.directCalls,
    blockedCalls: options.blockedCalls,
    reqId: '',
    step: options.step,
    stepId: options.stepId,
    signal: options.signal,
    emitEvent: (event) => sendToolEvents([event]),
    requestPermission: options.requestPermission,
    isToolApproved: options.isToolApproved,
    isCommandPrefixApproved: options.isCommandPrefixApproved,
    executeTool: (prep, isApproved) => options.executeTool(prep, isApproved, sendToolEvents)
  })

  const finalizedStep = finalizeToolStep({
    toolResponses,
    toolModelAttachments: options.toolModelAttachments
  })
  const status = stepHadToolFailure ? 'failed' : 'completed'

  options.emitEvent({
    type: 'agent_step_end',
    stepId: options.stepId,
    status
  })

  return {
    messagesToAppend: finalizedStep.messagesToAppend,
    lastRecordedCallId: finalizedStep.lastRecordedCallId,
    status
  }
}
