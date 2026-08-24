import { AgentEvent, ChatCompletionMessage } from '../../shared/types'
import { PreparedToolCall, getShellApprovalCommand } from './toolCallPlanning'

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

export const MAX_PARALLEL_SAFE_TOOL_CALLS = 4

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

async function runDirectCallsWithBarriers(
  calls: PreparedToolCall[],
  execute: (prep: PreparedToolCall) => Promise<void>
): Promise<void> {
  let safeGroup: PreparedToolCall[] = []
  const flushSafeGroup = async (): Promise<void> => {
    for (let offset = 0; offset < safeGroup.length; offset += MAX_PARALLEL_SAFE_TOOL_CALLS) {
      const settled = await Promise.allSettled(
        safeGroup
          .slice(offset, offset + MAX_PARALLEL_SAFE_TOOL_CALLS)
          .map(async (prep) => execute(prep))
      )
      const failure = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      if (failure) throw failure.reason
    }
    safeGroup = []
  }

  for (const prep of [...calls].sort((a, b) => a.index - b.index)) {
    if (prep.concurrencySafe === true) {
      safeGroup.push(prep)
      continue
    }
    await flushSafeGroup()
    await execute(prep)
  }
  await flushSafeGroup()
}

export async function runPreparedToolBatch(
  options: RunPreparedToolBatchOptions
): Promise<RunPreparedToolBatchResult> {
  const toolResponses = new Array<ChatCompletionMessage | undefined>(options.toolCallCount)
  const emitToolCall = (prep: PreparedToolCall, state: 'pending' | 'approved' | 'denied'): void => {
    options.emitEvent(createToolCallEvent(prep, state, options.step, options.stepId))
  }

  for (const prep of options.askCalls) {
    if (options.signal.aborted) break
    const { toolName, callId, args: toolArgs } = prep

    let isApproved = false
    const isToolApproved = options.isToolApproved(toolName)
    const shellApprovalCommand = getShellApprovalCommand(toolName, toolArgs)
    const isCmdApproved = shellApprovalCommand
      ? options.isCommandPrefixApproved(shellApprovalCommand)
      : false

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

  await runDirectCallsWithBarriers(nonInteractiveDirectCalls, async (prep) => {
    throwIfAborted(options.signal)
    emitToolCall(prep, 'approved')
    toolResponses[prep.index] = await options.executeTool(prep, true)
  })

  await Promise.all(
    options.blockedCalls.map(async (prep) => {
      toolResponses[prep.index] = await options.executeTool(prep, false)
    })
  )

  return { toolResponses }
}
