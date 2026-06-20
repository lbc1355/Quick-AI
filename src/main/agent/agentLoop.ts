import { BrowserWindow } from 'electron'
import {
  AgentSkillRunOptions,
  ChatCompletionMessage,
  AgentEvent,
  SessionResource
} from '../../shared/types'
import { ToolRegistry, searchToolDefinitions } from '../toolRegistry'
import { buildSkillMessages, prepareChatAgentMessages } from './messageBuilder'
import {
  getContextWindowSize,
  normalizeContextWindowTokens,
  trimMessagesToFit,
  TOOL_OUTPUT_SPILLOVER_THRESHOLD
} from './contextManager'
import { createRun, destroyRun } from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { ActionLog, getActionLogPath } from './actionLog'
import { SessionLogger } from './sessionLogger'
import { AmbiguousAction, loadRunCheckpoint, saveRunCheckpoint } from './runCheckpoint'
import {
  appendRunCheckpoint,
  createRunManifest,
  finishRunManifest
} from './runManifest'
import {
  ACTION_HISTORY_RESUME_LIMIT,
  buildBranchForkPrompt,
  buildCheckpointResumePrompt,
  cloneMessagesForCheckpoint,
  injectPromptBeforeLatestUser
} from './resumePrompts'
import { SIDE_EFFECTING_TOOLS } from './sideEffects'
import { prepareToolCalls } from './toolCallPlanning'
import type { ToolModelAttachment } from '../tools/types'
import { processPreparedToolStep } from './toolStepProcessor'
import { createToolStepExecutor } from './toolStepApplicator'
import { buildAgentStepPresentation } from './toolStepPresentation'
import { createToolDeclarationCache } from './toolDeclarationCache'
import { createRunUsageTracker } from './runUsageTracker'
import { runModelTurn } from './modelTurnRunner'

const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 30
  return Math.max(1, Math.min(30, Math.floor(value)))
}

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
  contextWindowTokens?: number
}): number =>
  normalizeContextWindowTokens(options.contextWindowTokens) ?? getContextWindowSize(options.model)

export const runAgentLoop = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: {
    apiUrl: string
    apiKey: string
    model: string
    contextWindowTokens?: number
    systemPrompt?: string
    messages?: ChatCompletionMessage[]
    skill?: AgentSkillRunOptions['skill']
    userInput?: string
    resources?: SessionResource[]
    /** Per-conversation id for action-log persistence. Falls back to reqId. */
    sessionId?: string
    projectRoot?: string
    projectName?: string
    /** Existing run checkpoint to continue without adding a new user message. */
    resumeFromRunId?: string
    resumeSourceSessionId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    branchOf?: { sessionId: string; messageId: string; runId?: string }
  },
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  const isSkill = !!options.skill
  const toolDiscovery = isSkill
    ? options.skill!.toolDiscovery === 'dynamic'
      ? 'dynamic'
      : 'static'
    : 'dynamic'

  const maxSteps = isSkill ? clampMaxSteps(options.skill!.maxSteps) : 30
  const resourceToolNames =
    options.resources && options.resources.length > 0
      ? ['list_cached_resources', 'read_cached_resource', 'search_cached_resource']
      : []
  const skillTools = isSkill
    ? Array.from(new Set([...(options.skill!.tools || []), ...resourceToolNames]))
    : []
  const toolScope = isSkill ? new Set<string>(skillTools) : 'all'

  // Per-conversation action log: persists tool call history across runs so the model can
  // consult what it did earlier in the same conversation, even after context truncation.
  const conversationId = options.sessionId || reqId
  const actionLog = new ActionLog(getActionLogPath(conversationId))
  const resumeSourceSessionId = options.resumeSourceSessionId || conversationId
  const resumeCheckpoint = options.resumeFromRunId
    ? loadRunCheckpoint(resumeSourceSessionId, options.resumeFromRunId)
    : undefined

  const resumeLoadError =
    options.resumeFromRunId && !resumeCheckpoint
      ? `No resumable checkpoint found for run ${options.resumeFromRunId}. Regenerate the message if you want to start over.`
      : undefined
  // Prepare messages history
  let messages: ChatCompletionMessage[] = []
  if (resumeLoadError) {
    messages = []
  } else if (resumeCheckpoint) {
    messages = cloneMessagesForCheckpoint(resumeCheckpoint.messages)
    messages.push({
      role: 'system',
      content: buildCheckpointResumePrompt(resumeCheckpoint, actionLog)
    })
  } else if (isSkill) {
    messages = buildSkillMessages({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemPrompt: options.systemPrompt,
      skill: options.skill!,
      userInput: options.userInput || '',
      resources: options.resources
    })
  } else {
    messages = prepareChatAgentMessages(
      options.messages || [],
      options.systemPrompt,
      options.resources,
      permissions,
      options.projectRoot,
      options.projectName
    )
  }
  if (options.branchOf) {
    messages = injectPromptBeforeLatestUser(messages, buildBranchForkPrompt(options.branchOf))
  }

  // Initialize Run Context
  const initialActiveTools = toolDiscovery === 'dynamic' ? ['search_tools'] : [...skillTools]
  if (resumeCheckpoint) {
    for (const toolName of resumeCheckpoint.activeTools) {
      if (!initialActiveTools.includes(toolName)) {
        initialActiveTools.push(toolName)
      }
    }
  }
  // Dynamic mode: pre-activate every tool surfaced in the system-prompt directory so that
  // "you may call them directly" actually holds. Without this, a direct call to a directory
  // tool that has not yet been discovered via search_tools fails the whitelist check and is
  // silently denied (no permission prompt) — the model sees a tool it cannot actually call.
  if (toolDiscovery === 'dynamic') {
    for (const summary of searchToolDefinitions('', 'all', permissions)) {
      if (!initialActiveTools.includes(summary.name)) {
        initialActiveTools.push(summary.name)
      }
    }
  }
  if (options.resources && options.resources.length > 0) {
    if (!initialActiveTools.includes('list_cached_resources')) {
      initialActiveTools.push('list_cached_resources')
    }
    if (!initialActiveTools.includes('read_cached_resource')) {
      initialActiveTools.push('read_cached_resource')
    }
    if (!initialActiveTools.includes('search_cached_resource')) {
      initialActiveTools.push('search_cached_resource')
    }
  }
  const runCtx = createRun(
    reqId,
    initialActiveTools,
    toolScope,
    actionLog,
    permissions,
    options.sessionId,
    options.projectRoot,
    options.projectName
  )
  runCtx.maxSteps = maxSteps
  const signal = runCtx.signal

  createRunManifest({
    runId: reqId,
    sessionId: conversationId,
    sourceMessageId: options.sourceMessageId,
    assistantMessageId: options.assistantMessageId,
    parentRunId: options.resumeFromRunId,
    branchOf: options.branchOf
  })

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
  const ambiguousActions: AmbiguousAction[] = [...(resumeCheckpoint?.ambiguousActions || [])]

  const persistCheckpoint = (checkpointStep: number, lastCompletedCallId?: string): void => {
    try {
      saveRunCheckpoint({
        sessionId: conversationId,
        reqId,
        step: checkpointStep,
        messages: cloneMessagesForCheckpoint(messages),
        activeTools: Array.from(runCtx.activeTools),
        lastCompletedCallId,
        ambiguousActions: ambiguousActions.slice(-ACTION_HISTORY_RESUME_LIMIT)
      })
      appendRunCheckpoint(conversationId, reqId, reqId)
    } catch (err) {
      console.warn('Failed to save run checkpoint:', (err as Error).message)
    }
  }

  const setRunEnd = (
    status: 'completed' | 'cancelled' | 'failed' | 'max_steps',
    error?: string
  ): void => {
    runCtx.status = status
    runCtx.completedAt = Date.now()
    if (error) {
      runCtx.error = error
    }
    finishRunManifest(conversationId, reqId, status, error)
    sendEvent(mainWindow, reqId, {
      type: 'agent_end',
      status,
      error
    })
    SessionLogger.logRunEnd(conversationId, status, error)
  }

  try {
    if (resumeLoadError) {
      throw new Error(resumeLoadError)
    }

    sendEvent(mainWindow, reqId, {
      type: 'agent_start',
      skillName: isSkill ? options.skill!.name : 'General Agent'
    })
    persistCheckpoint(0)

    SessionLogger.logRunStart(conversationId, reqId, {
      model: options.model,
      apiUrl: options.apiUrl,
      skillName: isSkill ? options.skill!.name : 'General Agent',
      messages
    })

    const toolDeclarationCache = createToolDeclarationCache({ toolRegistry: ToolRegistry })

    for (let step = 1; step <= maxSteps; ) {
      runCtx.currentStep = step
      const stepId = `${reqId}:step:${step}`
      if (signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      sendEvent(mainWindow, reqId, {
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

      // Stream assistant text as an unclassified model message until we know whether this
      // model turn becomes a tool step or the final answer. Some providers emit content
      // before tool_call deltas, so the final/step classification has to happen after the turn.
      const { assistantMessage, streamedText: assistantTextBuffer } = await runModelTurn({
        modelConfig: {
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          model: options.model
        },
        messages,
        toolsToDeclare,
        signal,
        usageTracker,
        onReasoning: (content) => {
          sendEvent(mainWindow, reqId, { type: 'reasoning', content, step, stepId })
        },
        onContentChunk: (content) => {
          sendEvent(mainWindow, reqId, {
            type: 'agent_message_delta',
            content,
            step,
            stepId
          })
        }
      })

      messages.push(assistantMessage)
      SessionLogger.logModelResponse(conversationId, assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const isToolWhitelisted = (toolName: string): boolean =>
          toolDiscovery === 'static' ? skillTools.includes(toolName) : runCtx.isToolActive(toolName)

        const { askCalls, directCalls, blockedCalls } = prepareToolCalls({
          toolCalls: assistantMessage.tool_calls,
          permissions,
          isToolWhitelisted,
          isToolApproved: (toolName) => runCtx.isToolApproved(toolName),
          isCommandPrefixApproved: (command) => runCtx.isCommandPrefixApproved(command),
          hasExecuted: (callKey) => runCtx.hasExecuted(callKey),
          loopGuard,
          projectRoot: runCtx.projectRoot
        })

        const preparedCalls = [...askCalls, ...directCalls, ...blockedCalls].sort(
          (a, b) => a.index - b.index
        )
        const assistantStepText = getAssistantText(assistantMessage.content) || assistantTextBuffer
        const stepPresentation = buildAgentStepPresentation(assistantStepText, preparedCalls)

        const toolModelAttachments = new Array<ToolModelAttachment[] | undefined>(
          assistantMessage.tool_calls.length
        )
        const executeTool = createToolStepExecutor({
          toolRegistry: ToolRegistry,
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
          activeTools: runCtx.activeTools,
          fetchUrlBudget,
          toolModelAttachments,
          actionLog: runCtx.actionLog,
          markExecuted: (callKey) => runCtx.markExecuted(callKey),
          storeToolOutput: (callId, text) => runCtx.storeToolOutput(callId, text),
          activateTool: (toolName) => runCtx.activateTool(toolName),
          onHaltRequested: () => {
            haltRequested = true
          },
          onAmbiguousAction: (action) => {
            ambiguousActions.push(action)
          },
          emitEvent: (event) => sendEvent(mainWindow, reqId, event)
        })

        const processedStep = await processPreparedToolStep({
          toolCallCount: assistantMessage.tool_calls.length,
          preparedCalls,
          askCalls,
          directCalls,
          blockedCalls,
          step,
          maxSteps,
          stepId,
          title: stepPresentation.title,
          message: stepPresentation.message,
          signal,
          emitEvent: (event) => sendEvent(mainWindow, reqId, event),
          requestPermission: (callId) => globalPermissionManager.requestPermission(reqId, callId),
          isToolApproved: (toolName) => runCtx.isToolApproved(toolName),
          isCommandPrefixApproved: (command) => runCtx.isCommandPrefixApproved(command),
          executeTool,
          toolModelAttachments
        })

        messages.push(...processedStep.messagesToAppend)
        persistCheckpoint(step, processedStep.lastRecordedCallId)

        // A loop-guard halt ends tool use immediately; fall through to the final-answer path.
        if (haltRequested) {
          break
        }

        step++
      } else {
        const finalText = getAssistantText(assistantMessage.content) || assistantTextBuffer
        if (finalText) {
          sendEvent(mainWindow, reqId, { type: 'final', content: finalText, step, stepId })
        }
        setRunEnd('completed')
        mainWindow.webContents.send('chat-chunk', buildDoneChunk())
        return
      }
    }

    // Tool use ended without a final answer — either the step ceiling was hit or the loop
    // guard halted on repeated failures. Ask the model for a best-effort final answer.
    messages.push({
      role: 'user',
      content: haltRequested
        ? 'Tool execution was halted after repeated consecutive failures. Please provide the best final answer you can based only on the observations available.'
        : 'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
    })

    if (signal.aborted) {
      throw new Error('Agent execution aborted by user.')
    }

    // Final call to model
    const contextSize = getEffectiveContextWindowSize(options)
    messages = trimMessagesToFit(messages, {
      maxTokens: contextSize,
      reserveForResponse: 2000,
      strategy: 'truncate-oldest-tool'
    })

    let forcedFinalEmitted = false
    const { assistantMessage: forcedFinalMessage } = await runModelTurn({
      modelConfig: {
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        model: options.model
      },
      messages,
      signal,
      usageTracker,
      onReasoning: (content) => {
        sendEvent(mainWindow, reqId, { type: 'reasoning', content })
      },
      onContentChunk: (content) => {
        forcedFinalEmitted = true
        sendEvent(mainWindow, reqId, { type: 'final', content })
      }
    })

    const forcedFinalText = getAssistantText(forcedFinalMessage.content)
    if (!forcedFinalEmitted && forcedFinalText) {
      sendEvent(mainWindow, reqId, { type: 'final', content: forcedFinalText })
    }

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
    destroyRun(reqId)
  }
}
