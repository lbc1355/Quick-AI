import type { ChatCompletionMessage, PromptCacheStats } from '../../shared/types'
import { promoteReasoningOnlyFinalAnswer } from './modelResponseNormalizer'
import type { CallModelCallbacks } from './modelCallTypes'

export const TOOL_CALL_PROGRESS_CHAR_INTERVAL = 4096
export const TOOL_CALL_PROGRESS_LINE_INTERVAL = 25
const FILE_WRITE_CONTENT_ARGUMENT_PATTERN = /"content"\s*:\s*"/

export type ModelEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | {
      type: 'tool-call-delta'
      index: number
      id?: string
      name?: string
      argumentsDelta?: string
      arguments?: string
      complete?: boolean
    }
  | { type: 'usage'; usage: PromptCacheStats }
  | { type: 'finish'; message: ChatCompletionMessage; usage?: PromptCacheStats }

export const countGeneratedArgumentLines = (
  toolName: string | undefined,
  argumentsText: string
): number => {
  const contentMatch =
    toolName === 'file_write' ? argumentsText.match(FILE_WRITE_CONTENT_ARGUMENT_PATTERN) : null
  const source =
    contentMatch?.index === undefined
      ? argumentsText
      : argumentsText.slice(contentMatch.index + contentMatch[0].length)
  if (!source) return 0

  const actualNewlines = source.match(/\r\n|\r|\n/g)?.length || 0
  const escapedNewlines = source.match(/\\n/g)?.length || 0
  return actualNewlines + escapedNewlines + 1
}

interface ToolProgressState {
  emittedStart: boolean
  lastEmittedArgumentsLength: number
  lastEmittedLineCount: number
  lastToolName?: string
}

/** Accumulates transport-neutral events into the legacy assistant message and callbacks. */
export class ModelEventAccumulator {
  readonly message: ChatCompletionMessage = {
    role: 'assistant',
    content: '',
    reasoning_content: '',
    tool_calls: []
  }

  usage?: PromptCacheStats
  hasVisibleOutput = false

  private readonly toolProgress = new Map<number, ToolProgressState>()

  constructor(private readonly callbacks?: CallModelCallbacks) {}

  consume(event: Exclude<ModelEvent, { type: 'finish' }>): void {
    this.callbacks?.onEvent?.(event)

    if (event.type === 'text-delta') {
      if (typeof this.message.content !== 'string') this.message.content = ''
      this.message.content += event.delta
      this.hasVisibleOutput = true
      this.callbacks?.onFinalChunk(event.delta)
      return
    }

    if (event.type === 'reasoning-delta') {
      this.message.reasoning_content = (this.message.reasoning_content || '') + event.delta
      this.hasVisibleOutput = true
      this.callbacks?.onReasoning(event.delta)
      return
    }

    if (event.type === 'usage') {
      this.usage = event.usage
      return
    }

    if (!this.message.tool_calls) this.message.tool_calls = []
    const toolCalls = this.message.tool_calls
    if (!toolCalls[event.index]) {
      toolCalls[event.index] = {
        id: event.id || '',
        type: 'function',
        function: { name: event.name || '', arguments: '' }
      }
    }

    const toolCall = toolCalls[event.index]
    if (event.id) toolCall.id = event.id
    if (event.name) toolCall.function.name = event.name
    if (event.arguments !== undefined) {
      toolCall.function.arguments = event.arguments
    } else if (event.argumentsDelta) {
      toolCall.function.arguments += event.argumentsDelta
    }
    this.emitToolProgress(event.index, event.argumentsDelta?.length || 0, event.complete)
  }

  finalize(): ChatCompletionMessage {
    this.message.tool_calls?.forEach((toolCall, index) => {
      if (toolCall) this.emitToolProgress(index, 0, true)
    })

    if (this.message.tool_calls) {
      this.message.tool_calls = this.message.tool_calls.filter(
        (toolCall) => toolCall && toolCall.function?.name
      )
      if (this.message.tool_calls.length === 0) delete this.message.tool_calls
    }

    const promotedFinalAnswer = promoteReasoningOnlyFinalAnswer(this.message)
    if (promotedFinalAnswer) this.callbacks?.onFinalChunk(promotedFinalAnswer)

    this.callbacks?.onEvent?.({
      type: 'finish',
      message: this.message,
      usage: this.usage
    })
    return this.message
  }

  private emitToolProgress(index: number, argumentsDeltaLength: number, force = false): void {
    if (!this.callbacks?.onToolCallProgress) return
    const toolCall = this.message.tool_calls?.[index]
    if (!toolCall) return

    const toolName = toolCall.function.name || undefined
    if (!toolName && !toolCall.id) return

    const state = this.toolProgress.get(index) || {
      emittedStart: false,
      lastEmittedArgumentsLength: 0,
      lastEmittedLineCount: 0,
      lastToolName: undefined
    }
    const argumentsLength = toolCall.function.arguments.length
    const generatedLineCount = countGeneratedArgumentLines(toolName, toolCall.function.arguments)
    const shouldEmitStart = !state.emittedStart
    const shouldEmitToolName = Boolean(toolName && toolName !== state.lastToolName)
    const shouldEmitArguments =
      argumentsLength - state.lastEmittedArgumentsLength >= TOOL_CALL_PROGRESS_CHAR_INTERVAL
    const shouldEmitLines =
      generatedLineCount > 0 &&
      (state.lastEmittedLineCount === 0 ||
        generatedLineCount - state.lastEmittedLineCount >= TOOL_CALL_PROGRESS_LINE_INTERVAL)
    const shouldEmitFinal =
      force &&
      (argumentsLength !== state.lastEmittedArgumentsLength ||
        generatedLineCount !== state.lastEmittedLineCount ||
        toolName !== state.lastToolName)

    if (
      !shouldEmitStart &&
      !shouldEmitToolName &&
      !shouldEmitArguments &&
      !shouldEmitLines &&
      !shouldEmitFinal
    ) {
      return
    }

    this.callbacks.onToolCallProgress({
      index,
      id: toolCall.id || undefined,
      toolName,
      argumentsLength,
      argumentsDeltaLength,
      generatedLineCount
    })
    this.toolProgress.set(index, {
      emittedStart: true,
      lastEmittedArgumentsLength: argumentsLength,
      lastEmittedLineCount: generatedLineCount,
      lastToolName: toolName
    })
  }
}
