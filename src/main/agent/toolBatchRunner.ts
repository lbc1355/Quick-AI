import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { PreparedToolCall } from './toolCallPlanning'

export type ExecutePreparedTool = (
  prep: PreparedToolCall,
  isApproved: boolean
) => Promise<ChatCompletionMessage>

export interface RunPreparedToolBatchOptions {
  toolCallCount: number
  askCalls: PreparedToolCall[]
  directCalls: PreparedToolCall[]
  blockedCalls: PreparedToolCall[]
  reqId: string
  step: number
  stepId: string
  signal: AbortSignal
  emitEvent: (event: AgentEvent) => void
  requestPermission: (callId: string) => Promise<boolean>
  isToolApproved: (toolName: string) => boolean
  isCommandPrefixApproved: (command: string) => boolean
  executeTool: ExecutePreparedTool
}

export interface RunPreparedToolBatchResult {
  toolResponses: Array<ChatCompletionMessage | undefined>
}

const createToolCallEvent = (
  prep: PreparedToolCall,
  state: 'pending' | 'approved' | 'denied',
  step: number,
  stepId: string
): AgentEvent => ({
  type: 'tool_call',
  callId: prep.callId,
  toolName: prep.toolName,
  args: prep.args,
  purpose: prep.purpose,
  permissionState: state,
  step,
  stepId
})

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new Error('Agent execution aborted by user.')
  }
}

export async function runPreparedToolBatch(
  options: RunPreparedToolBatchOptions
): Promise<RunPreparedToolBatchResult> {
  const toolResponses = new Array<ChatCompletionMessage | undefined>(options.toolCallCount)
  const emitToolCall = (prep: PreparedToolCall, state: 'pending' | 'approved' | 'denied') => {
    options.emitEvent(createToolCallEvent(prep, state, options.step, options.stepId))
  }

  for (const prep of options.askCalls) {
    if (options.signal.aborted) break
    const { toolName, callId, args: toolArgs } = prep

    let isApproved = false
    const isToolApproved = options.isToolApproved(toolName)
    const isCmdApproved =
      toolName === 'shell' &&
      typeof toolArgs.command === 'string' &&
      options.isCommandPrefixApproved(toolArgs.command)

    if (isToolApproved || isCmdApproved) {
      isApproved = true
    } else {
      emitToolCall(prep, 'pending')

      try {
        isApproved = await options.requestPermission(callId)
      } catch (err) {
        const error = err as Error
        emitToolCall(prep, 'denied')
        options.emitEvent({
          type: 'tool_error',
          callId,
          error: error.message,
          step: options.step,
          stepId: options.stepId
        })
        toolResponses[prep.index] = {
          role: 'tool',
          tool_call_id: callId,
          name: toolName,
          content: `ERROR: ${error.message}`
        }
        if (options.signal.aborted) break
        continue
      }
    }

    emitToolCall(prep, isApproved ? 'approved' : 'denied')
    toolResponses[prep.index] = await options.executeTool(prep, isApproved)
  }

  throwIfAborted(options.signal)

  const interactiveDirectCalls = options.directCalls.filter(
    (prep) => prep.toolName === 'ask_user_choice'
  )
  const nonInteractiveDirectCalls = options.directCalls.filter(
    (prep) => prep.toolName !== 'ask_user_choice'
  )

  for (const prep of interactiveDirectCalls) {
    if (options.signal.aborted) break
    emitToolCall(prep, 'approved')
    toolResponses[prep.index] = await options.executeTool(prep, true)
  }

  throwIfAborted(options.signal)

  await Promise.all(
    nonInteractiveDirectCalls.map(async (prep) => {
      emitToolCall(prep, 'approved')
      toolResponses[prep.index] = await options.executeTool(prep, true)
    })
  )

  await Promise.all(
    options.blockedCalls.map(async (prep) => {
      toolResponses[prep.index] = await options.executeTool(prep, false)
    })
  )

  return { toolResponses }
}
