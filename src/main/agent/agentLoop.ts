import { BrowserWindow } from 'electron'
import { AgentEvent, ModelRuntimeConfig } from '../../shared/types'
import { normalizeRuntimeError } from '../../shared/runtimeErrors'
import { AgentHostActions } from '../tools/types'
import { getToolRegistryView } from '../toolRegistry'
import { materializeToolRegistry } from '../tools/registryView'
import {
  getContextWindowSize,
  normalizeContextWindowTokens,
  trimMessagesToFit,
  getToolOutputSpilloverThreshold,
  DEFAULT_RESPONSE_RESERVE_RATIO
} from './contextManager'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { SessionLogger } from './sessionLogger'
import { SIDE_EFFECTING_TOOLS } from './sideEffects'
import { createToolDeclarationCache } from './toolDeclarationCache'
import { createRunUsageTracker } from './runUsageTracker'
import { runModelTurn } from './modelTurnRunner'
import { ToolCallStreamProgress } from './callModel'
import { AgentRunOptions, prepareAgentRun } from './agentRunPreparation'
import { runToolTurn } from './toolTurnRunner'
import { runForcedFinalTurn } from './forcedFinalTurnRunner'
import { getMessageText as getAssistantText } from './messageText'
import { startAgentRunLifecycle } from './agentRunLifecycle'
import { persistAgentRunCheckpoint } from './agentRunCheckpoint'
import { createAgentEventStream } from './agentEventStream'
import { createAgentEventJournalWriter } from './agentEventJournal'
import { compactStaleToolResultsForContextPressure } from './staleToolResultCompaction'
import { normalizeContextEpoch } from '../../shared/contextEpoch'
import { beginAgentFileSnapshot } from './agentFileSnapshot'
import { deliverBackgroundSubagentResult } from './backgroundSubagentDelivery'
import {
  captureCacheShape,
  commitCacheShapeForSession,
  previewCacheShapeForSession
} from './cacheShapeDiagnostics'

const sendEvent = (
  mainWindow: BrowserWindow,
  reqId: string,
  contextEpoch: number,
  event: AgentEvent
): void => {
  mainWindow.webContents.send('chat-chunk', { reqId, contextEpoch, event })
}

// The single Electron transport boundary for the tool layer: everything below runToolTurn only
// sees these plain callbacks, never a BrowserWindow.
const createAgentHostActions = (
  mainWindow: BrowserWindow,
  parent: {
    sessionId: string
    contextEpoch: number
    runId: string
    assistantMessageId?: string
  }
): AgentHostActions => ({
  requestUserChoice: (request) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('user-choice-request', request)
    }
  },
  focusWindow: () => {
    if (mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  },
  publishBackgroundSubagentCompletion: (completion) => {
    deliverBackgroundSubagentResult({
      completion,
      sessionId: parent.sessionId,
      contextEpoch: parent.contextEpoch,
      parentRunId: parent.runId,
      parentAssistantMessageId: parent.assistantMessageId,
      send: (notification) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('background-subagent-result', notification)
        }
      }
    })
  },
  publishBackgroundSubagentEvent: (update) => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('background-subagent-event', {
      ...update,
      sessionId: parent.sessionId,
      contextEpoch: parent.contextEpoch,
      parentRunId: parent.runId,
      parentAssistantMessageId: parent.assistantMessageId
    })
  }
})

const formatToolCallProgressMessage = (progress: ToolCallStreamProgress): string => {
  const toolName = progress.toolName || 'tool'
  if (toolName === 'file_write') {
    return `正在生成写入内容：已生成 ${progress.generatedLineCount} 行`
  }
  return `正在准备工具调用：${toolName}（已生成 ${progress.generatedLineCount} 行参数）`
}
const STREAM_OUTPUT_PROGRESS_LINE_INTERVAL = 25

const countNewLines = (content: string): number => content.match(/\r\n|\r|\n/g)?.length || 0

const createStreamLineProgressTracker = (
  emitProgress: (lineCount: number) => void
): ((content: string, force?: boolean) => void) => {
  let hasContent = false
  let lineCount = 0
  let lastEmittedLineCount = 0

  return (content: string, force = false): void => {
    if (content) {
      if (!hasContent) {
        hasContent = true
        lineCount = 1
      }
      lineCount += countNewLines(content)
    }

    if (!hasContent) return

    const shouldEmitStart = lastEmittedLineCount === 0
    const shouldEmitLines = lineCount - lastEmittedLineCount >= STREAM_OUTPUT_PROGRESS_LINE_INTERVAL
    const shouldEmitFinal = force && lineCount !== lastEmittedLineCount

    if (!shouldEmitStart && !shouldEmitLines && !shouldEmitFinal) return

    lastEmittedLineCount = lineCount
    emitProgress(lineCount)
  }
}

const formatStreamLineProgressMessage = (label: string, lineCount: number): string =>
  `正在输出${label}：已输出 ${lineCount} 行`

const getEffectiveContextWindowSize = (options: {
  model: string
  modelRuntime?: ModelRuntimeConfig
  contextWindowTokens?: number
}): number =>
  normalizeContextWindowTokens(options.contextWindowTokens) ??
  normalizeContextWindowTokens(options.modelRuntime?.contextWindowTokens) ??
  getContextWindowSize(options.model)

export const runAgentLoop = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: AgentRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  const preparedRun = prepareAgentRun({ reqId, options, permissions })
  const {
    isSkill,
    toolDiscovery,
    maxSteps,
    skillTools,
    toolScope,
    conversationId,
    actionLog,
    resumeLoadError,
    initialActiveTools
  } = preparedRun
  let messages = preparedRun.messages
  const contextEpoch = normalizeContextEpoch(options.contextEpoch)

  const eventJournal = createAgentEventJournalWriter({
    runId: reqId,
    sessionId: conversationId,
    contextEpoch,
    sourceMessageId: options.sourceMessageId,
    assistantMessageId: options.assistantMessageId,
    parentRunId: options.resumeFromRunId
  })

  const eventStream = createAgentEventStream({
    runId: reqId,
    emit: (event) => {
      eventJournal.append(event)
      sendEvent(mainWindow, reqId, contextEpoch, event)
    }
  })

  const lifecycle = startAgentRunLifecycle({
    reqId,
    conversationId,
    maxSteps,
    initialActiveTools,
    toolScope,
    actionLog,
    permissions,
    sessionId: options.sessionId,
    projectRoot: options.projectRoot,
    projectName: options.projectName,
    sourceMessageId: options.sourceMessageId,
    assistantMessageId: options.assistantMessageId,
    parentRunId: options.resumeFromRunId,
    branchOf: options.branchOf,
    emitEvent: eventStream.emit
  })
  const runCtx = lifecycle.runCtx
  const signal = runCtx.signal
  const hostActions = createAgentHostActions(mainWindow, {
    sessionId: conversationId,
    contextEpoch,
    runId: reqId,
    assistantMessageId: options.assistantMessageId
  })
  const fileSnapshotHandle = await beginAgentFileSnapshot({
    sessionId: conversationId,
    runId: reqId,
    projectRoot: options.projectRoot
  })
  let fileSnapshotFinalized = false
  const finalizeFileSnapshot = async (): Promise<void> => {
    if (fileSnapshotFinalized) return
    fileSnapshotFinalized = true
    const snapshot = await fileSnapshotHandle?.finish()
    if (snapshot && snapshot.files.length > 0) {
      eventStream.emit({ type: 'file_changes', files: snapshot.files })
    }
  }

  const initialContextSize = getEffectiveContextWindowSize(options)
  const initialToolOutputSpilloverThreshold = getToolOutputSpilloverThreshold(initialContextSize)

  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.tool_call_id &&
      typeof message.content === 'string' &&
      message.content.length > initialToolOutputSpilloverThreshold
    ) {
      runCtx.storeToolOutput(message.tool_call_id, message.content)
      runCtx.activateTool('read_tool_output')
    }
  }

  const fetchUrlBudget = { count: 0, max: 10 }
  const usageTracker = createRunUsageTracker()

  const buildDoneChunk = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const cacheStats = usageTracker.getAggregatedCacheStats()
    return {
      reqId,
      contextEpoch,
      ...extra,
      done: true,
      tokenSpeed: usageTracker.getTokenSpeed(),
      ...(cacheStats ? { cacheStats } : {})
    }
  }

  // Behavioural guardrails (repeated-call blocking + consecutive-failure halt) that
  // complement the hard maxSteps ceiling. Scoped to this run.
  const loopGuard = new LoopGuard()
  let haltRequested = false
  const ambiguousActions = [...preparedRun.ambiguousActions]

  const persistCheckpoint = (checkpointStep: number, lastCompletedCallId?: string): void => {
    persistAgentRunCheckpoint({
      conversationId,
      reqId,
      step: checkpointStep,
      messages,
      activeTools: runCtx.activeTools,
      lastCompletedCallId,
      ambiguousActions
    })
  }

  const setRunEnd = lifecycle.finish

  const appendSteering = (close: boolean): number => {
    const steering = options.drainSteering?.(close) || []
    if (steering.length === 0) return 0

    const admissionIds: string[] = []
    for (const prompt of steering) {
      messages.push(...prompt.messages)
      admissionIds.push(prompt.admissionId)
    }
    try {
      options.onSteeringConsumed?.(admissionIds)
    } catch (error) {
      console.error('Failed to persist consumed steering prompts:', error)
    }
    return steering.length
  }

  try {
    if (resumeLoadError) {
      throw new Error(resumeLoadError)
    }

    eventStream.emit({
      type: 'agent_start',
      skillName: isSkill ? options.skill!.name : 'General Agent'
    })
    persistCheckpoint(0)

    SessionLogger.logRunStart(conversationId, reqId, {
      model: options.model,
      apiUrl: options.apiUrl,
      skillName: isSkill ? options.skill!.name : 'General Agent',
      messages,
      contextRetentionMode: options.contextRetentionMode,
      cachePriorityRetainedRuns: options.cachePriorityRetainedRuns,
      contextWindowTokens: getEffectiveContextWindowSize(options),
      initialActiveTools
    })

    const toolRegistry = getToolRegistryView()
    const toolDeclarationCache = createToolDeclarationCache({ toolRegistry })

    for (let step = 1; step <= maxSteps; ) {
      runCtx.currentStep = step
      const stepId = `${reqId}:step:${step}`
      if (signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      // Steering is admitted while a model/tool turn is in flight, then merged only here at
      // the provider-turn boundary so tool-call/result ordering cannot be corrupted.
      options.setSteeringAcceptance?.(true)
      const steeringCount = appendSteering(false)
      if (steeringCount > 0) {
        persistCheckpoint(Math.max(0, step - 1))
      }

      eventStream.emit({
        type: 'agent_progress',
        step,
        maxSteps,
        stepId,
        activeTools: Array.from(runCtx.activeTools)
      })

      SessionLogger.logStepStart(conversationId, step, maxSteps)

      const toolRegistrySnapshot = materializeToolRegistry(toolRegistry)
      const toolsToDeclare = toolDeclarationCache.getDeclarations({
        toolDiscovery,
        activeTools: runCtx.activeTools,
        skillTools,
        permissions,
        toolRegistry: toolRegistrySnapshot,
        registryRevision: toolRegistrySnapshot.revision
      })

      // Phase 1: Context Size Control & Message Trimming
      const contextSize = getEffectiveContextWindowSize(options)
      const toolOutputSpilloverThreshold = getToolOutputSpilloverThreshold(contextSize)
      const staleToolCompaction = compactStaleToolResultsForContextPressure(messages, {
        maxTokens: contextSize
      })
      if (staleToolCompaction.compactedCount > 0) {
        messages = staleToolCompaction.messages
        eventStream.emit({
          type: 'agent_progress',
          step,
          maxSteps,
          stepId,
          activeTools: Array.from(runCtx.activeTools),
          message: `Compacted ${staleToolCompaction.compactedCount} stale tool results before context trimming`
        })
      }
      messages = trimMessagesToFit(messages, {
        maxTokens: contextSize,
        reserveForResponseRatio: DEFAULT_RESPONSE_RESERVE_RATIO,
        strategy: 'truncate-oldest-tool',
        toolOutputSpilloverThreshold
      })

      const cacheShape = captureCacheShape({
        messages,
        toolsToDeclare,
        contextRetentionMode: options.contextRetentionMode,
        cachePriorityRetainedRuns: options.cachePriorityRetainedRuns
      })
      const requestCacheDiagnostics = previewCacheShapeForSession(conversationId, cacheShape)

      SessionLogger.logModelRequest(conversationId, {
        step,
        messages,
        toolsToDeclare,
        contextWindowTokens: contextSize,
        cacheDiagnostics: requestCacheDiagnostics
      })

      // Stream assistant text as an unclassified model message until we know whether this
      // model turn becomes a tool step or the final answer. Some providers emit content
      // before tool_call deltas, so the final/step classification has to happen after the turn.
      const emitModelOutputProgress = (message: string): void => {
        eventStream.emit({
          type: 'agent_progress',
          step,
          maxSteps,
          stepId,
          activeTools: Array.from(runCtx.activeTools),
          message
        })
      }

      const reasoningLineProgress = createStreamLineProgressTracker((lineCount) => {
        emitModelOutputProgress(formatStreamLineProgressMessage('思考', lineCount))
      })
      const {
        assistantMessage,
        streamedText: assistantTextBuffer,
        cacheStats
      } = await runModelTurn({
        modelConfig: {
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          model: options.model,
          modelRuntime: options.modelRuntime
        },
        messages,
        toolsToDeclare,
        signal,
        usageTracker,
        onReasoning: (content) => {
          eventStream.emit({ type: 'reasoning', content, step, stepId })
          reasoningLineProgress(content)
        },
        onContentChunk: (content) => {
          eventStream.emit({
            type: 'agent_message_delta',
            content,
            step,
            stepId
          })
        },
        onToolCallProgress: (progress) => {
          eventStream.emit({
            type: 'agent_progress',
            step,
            maxSteps,
            stepId,
            activeTools: Array.from(runCtx.activeTools),
            message: formatToolCallProgressMessage(progress)
          })
        },
        decorateCacheStats: (stats) => {
          const diagnostics = commitCacheShapeForSession(conversationId, cacheShape, stats)
          if (!stats) return undefined
          return { ...stats, cacheDiagnostics: diagnostics }
        }
      })

      reasoningLineProgress('', true)

      messages.push(assistantMessage)
      SessionLogger.logModelResponse(conversationId, assistantMessage, cacheStats)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolTurn = await runToolTurn({
          assistantMessage,
          assistantTextBuffer,
          toolDiscovery,
          skillTools,
          permissions,
          toolRegistry: toolRegistrySnapshot,
          reqId,
          conversationId,
          step,
          maxSteps,
          stepId,
          signal,
          host: hostActions,
          resources: options.resources,
          agentModel: {
            apiUrl: options.apiUrl,
            apiKey: options.apiKey,
            model: options.model,
            modelRuntime: options.modelRuntime,
            contextWindowTokens: options.contextWindowTokens
          },
          retryPolicy: DEFAULT_RETRY_POLICY,
          isSideEffecting: (toolName) => SIDE_EFFECTING_TOOLS.has(toolName),
          loopGuard,
          outputSpilloverThreshold: toolOutputSpilloverThreshold,
          fetchUrlBudget,
          runContext: runCtx,
          emitEvent: eventStream.emit,
          requestPermission: (callId) => globalPermissionManager.requestPermission(reqId, callId)
        })

        messages.push(...toolTurn.messagesToAppend)
        ambiguousActions.push(...toolTurn.ambiguousActions)
        persistCheckpoint(step, toolTurn.lastRecordedCallId)

        // A loop-guard halt ends tool use immediately; fall through to the final-answer path.
        if (toolTurn.haltRequested) {
          haltRequested = true
          break
        }

        step++
      } else {
        // Stop accepting new steering and atomically drain anything admitted during this model
        // call before committing the response as terminal. A late prompt gets another turn.
        const lateSteeringCount = appendSteering(true)
        if (lateSteeringCount > 0) {
          persistCheckpoint(step)
          step++
          continue
        }
        const finalText = getAssistantText(assistantMessage.content) || assistantTextBuffer
        if (finalText) {
          eventStream.emit({ type: 'final', content: finalText, step, stepId })
        }
        await finalizeFileSnapshot()
        setRunEnd('completed')
        mainWindow.webContents.send('chat-chunk', buildDoneChunk())
        return
      }
    }

    // Tool use ended without a final answer, either the step ceiling was hit or the loop
    // guard halted on repeated failures. Ask the model for a best-effort final answer.
    options.setSteeringAcceptance?.(false)
    const forcedFinalTurn = await runForcedFinalTurn({
      messages,
      haltRequested,
      signal,
      modelConfig: {
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        model: options.model,
        modelRuntime: options.modelRuntime
      },
      contextSize: getEffectiveContextWindowSize(options),
      usageTracker,
      emitReasoning: (content) => {
        eventStream.emit({ type: 'reasoning', content })
      },
      emitFinal: (content) => {
        eventStream.emit({ type: 'final', content })
      }
    })
    messages = forcedFinalTurn.messages

    await finalizeFileSnapshot()
    setRunEnd('max_steps')
    mainWindow.webContents.send('chat-chunk', buildDoneChunk())
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    const isAborted =
      signal.aborted || err.message?.includes('aborted') || err.name === 'AbortError'
    await finalizeFileSnapshot()
    if (isAborted) {
      setRunEnd('cancelled')
      mainWindow.webContents.send('chat-chunk', buildDoneChunk({ cancelled: true }))
    } else {
      setRunEnd('failed', err.message || 'Agent Loop failed')
      const payload = normalizeRuntimeError(err, 'agent')
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        contextEpoch,
        error: err.message || 'Agent Loop failed',
        errorPayload: payload
      })
      mainWindow.webContents.send('chat-chunk', buildDoneChunk())
    }
  } finally {
    options.setSteeringAcceptance?.(false)
    await finalizeFileSnapshot()
    eventJournal.close()
    actionLog.save()
    lifecycle.destroy()
  }
}
