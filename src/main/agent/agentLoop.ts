import { BrowserWindow } from 'electron'
import { ChatCompletionMessage, AgentEvent, ModelRuntimeConfig } from '../../shared/types'
import { getToolRegistryView } from '../toolRegistry'
import {
  getContextWindowSize,
  normalizeContextWindowTokens,
  trimMessagesToFit,
  TOOL_OUTPUT_SPILLOVER_THRESHOLD
} from './contextManager'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { SessionLogger } from './sessionLogger'
import { SIDE_EFFECTING_TOOLS } from './sideEffects'
import { createToolDeclarationCache } from './toolDeclarationCache'
import { createRunUsageTracker } from './runUsageTracker'
import { runModelTurn } from './modelTurnRunner'
import { AgentRunOptions, prepareAgentRun } from './agentRunPreparation'
import { runToolTurn } from './toolTurnRunner'
import { runForcedFinalTurn } from './forcedFinalTurnRunner'
import { startAgentRunLifecycle } from './agentRunLifecycle'
import { persistAgentRunCheckpoint } from './agentRunCheckpoint'
import { createAgentEventStream } from './agentEventStream'
import { getPromptCacheStats } from './callModel'

const sendEvent = (mainWindow: BrowserWindow, reqId: string, event: AgentEvent): void => {
  mainWindow.webContents.send('chat-chunk', { reqId, event })
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

  const eventStream = createAgentEventStream({
    runId: reqId,
    emit: (event) => sendEvent(mainWindow, reqId, event)
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

  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.tool_call_id &&
      typeof message.content === 'string' &&
      message.content.length > TOOL_OUTPUT_SPILLOVER_THRESHOLD
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

      eventStream.emit({
        type: 'agent_progress',
        step,
        maxSteps,
        stepId,
        activeTools: Array.from(runCtx.activeTools)
      })

      SessionLogger.logStepStart(conversationId, step, maxSteps)

      const toolsToDeclare = toolDeclarationCache.getDeclarations({
        toolDiscovery,
        activeTools: runCtx.activeTools,
        skillTools,
        permissions
      })

      // Phase 1: Context Size Control & Message Trimming
      const contextSize = getEffectiveContextWindowSize(options)
      messages = trimMessagesToFit(messages, {
        maxTokens: contextSize,
        reserveForResponse: 2000,
        strategy: 'truncate-oldest-tool'
      })

      SessionLogger.logModelRequest(conversationId, {
        step,
        messages,
        toolsToDeclare,
        contextWindowTokens: contextSize
      })

      // Stream assistant text as an unclassified model message until we know whether this
      // model turn becomes a tool step or the final answer. Some providers emit content
      // before tool_call deltas, so the final/step classification has to happen after the turn.
      const { assistantMessage, streamedText: assistantTextBuffer } = await runModelTurn({
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
        },
        onContentChunk: (content) => {
          eventStream.emit({
            type: 'agent_message_delta',
            content,
            step,
            stepId
          })
        }
      })

      messages.push(assistantMessage)
      SessionLogger.logModelResponse(
        conversationId,
        assistantMessage,
        getPromptCacheStats(assistantMessage)
      )

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolTurn = await runToolTurn({
          assistantMessage,
          assistantTextBuffer,
          toolDiscovery,
          skillTools,
          permissions,
          toolRegistry,
          reqId,
          conversationId,
          step,
          maxSteps,
          stepId,
          signal,
          mainWindow,
          resources: options.resources,
          retryPolicy: DEFAULT_RETRY_POLICY,
          isSideEffecting: (toolName) => SIDE_EFFECTING_TOOLS.has(toolName),
          loopGuard,
          outputSpilloverThreshold: TOOL_OUTPUT_SPILLOVER_THRESHOLD,
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
        const finalText = getAssistantText(assistantMessage.content) || assistantTextBuffer
        if (finalText) {
          eventStream.emit({ type: 'final', content: finalText, step, stepId })
        }
        setRunEnd('completed')
        mainWindow.webContents.send('chat-chunk', buildDoneChunk())
        return
      }
    }

    // Tool use ended without a final answer, either the step ceiling was hit or the loop
    // guard halted on repeated failures. Ask the model for a best-effort final answer.
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

    setRunEnd('max_steps')
    mainWindow.webContents.send('chat-chunk', buildDoneChunk())
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    const isAborted =
      signal.aborted || err.message?.includes('aborted') || err.name === 'AbortError'
    if (isAborted) {
      setRunEnd('cancelled')
      mainWindow.webContents.send('chat-chunk', buildDoneChunk({ cancelled: true }))
    } else {
      setRunEnd('failed', err.message || 'Agent Loop failed')
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        error: err.message || 'Agent Loop failed'
      })
      mainWindow.webContents.send('chat-chunk', buildDoneChunk())
    }
  } finally {
    actionLog.save()
    lifecycle.destroy()
  }
}
