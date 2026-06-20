import { BrowserWindow } from 'electron'
import {
  AgentSkillRunOptions,
  ChatCompletionMessage,
  AgentEvent,
  ChatToolDeclaration,
  SessionResource,
  PromptCacheStats
} from '../../shared/types'
import { ToolRegistry, toChatToolDeclaration, searchToolDefinitions } from '../toolRegistry'
import { buildSkillMessages, prepareChatAgentMessages } from './messageBuilder'
import {
  getContextWindowSize,
  normalizeContextWindowTokens,
  trimMessagesToFit,
  TOOL_OUTPUT_SPILLOVER_THRESHOLD
} from './contextManager'
import { callModel, getPromptCacheStats } from './callModel'
import { estimateTokens } from './tokenEstimator'
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
import { prepareToolCalls, PreparedToolCall } from './toolCallPlanning'
import type { ToolModelAttachment } from '../tools/types'
import { recordToolAction } from './toolActionRecorder'
import { executePreparedToolCall } from './preparedToolExecutor'
import { runPreparedToolBatch } from './toolBatchRunner'
import { finalizeToolStep } from './toolStepFinalizer'

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

const compactText = (text: string): string => text.replace(/\s+/g, ' ').trim()

const stripMarkdownMarkers = (text: string): string =>
  text
    .replace(/[`*_#[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const truncate = (text: string, maxLength: number): string => {
  const clean = compactText(text)
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 1))}…` : clean
}

const buildToolNamesSummary = (calls: PreparedToolCall[]): string => {
  const names = Array.from(new Set(calls.map((call) => call.toolName).filter(Boolean)))
  if (names.length === 0) return '工具'
  if (names.length <= 3) return names.join('、')
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 类工具`
}

const buildAgentStepPresentation = (
  assistantText: string,
  calls: PreparedToolCall[]
): { title: string; message: string } => {
  const visibleMessage = compactText(assistantText)
  const purposes = calls
    .map((call) => (typeof call.purpose === 'string' ? compactText(call.purpose) : ''))
    .filter(Boolean)

  let message = visibleMessage
  if (!message && purposes.length === 1) {
    message = purposes[0]
  } else if (!message && purposes.length > 1) {
    message = `准备执行 ${calls.length} 个工具：${purposes.slice(0, 2).join('；')}${
      purposes.length > 2 ? '…' : ''
    }`
  } else if (!message) {
    message = `准备调用 ${calls.length} 个工具：${buildToolNamesSummary(calls)}。`
  }

  const firstSentence =
    stripMarkdownMarkers(message)
      .split(/[。.!?\n]/)
      .map((part) => part.trim())
      .find(Boolean) || `调用 ${buildToolNamesSummary(calls)}`

  return {
    title: truncate(firstSentence, 42),
    message
  }
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
  let totalGeneratedTokens = 0
  let totalGenerationTimeMs = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let totalCachePromptTokens = 0
  let totalCompletionTokens = 0
  let totalReasoningTokens = 0
  let totalUsageTokens = 0
  let hasCacheStats = false
  let hasUsageStats = false

  const getTokenSpeed = (): number => {
    const totalGenerationSec = totalGenerationTimeMs / 1000
    return totalGenerationSec > 0
      ? Number((totalGeneratedTokens / totalGenerationSec).toFixed(1))
      : 0
  }

  const addPromptCacheStats = (stats: PromptCacheStats | undefined): void => {
    if (!stats) return

    if (stats.promptTokens !== undefined) {
      hasUsageStats = true
      totalCachePromptTokens += stats.promptTokens
    }
    if (stats.completionTokens !== undefined) {
      hasUsageStats = true
      totalCompletionTokens += stats.completionTokens
    }
    if (stats.reasoningTokens !== undefined) {
      hasUsageStats = true
      totalReasoningTokens += stats.reasoningTokens
    }
    if (stats.totalTokens !== undefined) {
      hasUsageStats = true
      totalUsageTokens += stats.totalTokens
    }

    if (stats.hasCacheStats === false) return

    hasCacheStats = true
    totalCacheHitTokens += stats.cacheHitTokens
    if (stats.cacheMissTokens !== undefined) {
      totalCacheMissTokens += stats.cacheMissTokens
    } else if (stats.promptTokens !== undefined) {
      totalCacheMissTokens += Math.max(0, stats.promptTokens - stats.cacheHitTokens)
    }
  }

  const getAggregatedCacheStats = (): PromptCacheStats | undefined => {
    if (!hasCacheStats && !hasUsageStats) return undefined
    const denominator =
      totalCacheHitTokens + totalCacheMissTokens > 0
        ? totalCacheHitTokens + totalCacheMissTokens
        : totalCachePromptTokens
    const totalTokens =
      totalUsageTokens > 0
        ? totalUsageTokens
        : totalCachePromptTokens + totalCompletionTokens > 0
          ? totalCachePromptTokens + totalCompletionTokens
          : undefined
    return {
      hasCacheStats,
      promptTokens: totalCachePromptTokens > 0 ? totalCachePromptTokens : undefined,
      completionTokens: totalCompletionTokens > 0 ? totalCompletionTokens : undefined,
      totalTokens,
      reasoningTokens: totalReasoningTokens > 0 ? totalReasoningTokens : undefined,
      cacheHitTokens: totalCacheHitTokens,
      cacheMissTokens: hasCacheStats ? totalCacheMissTokens : undefined,
      hitRate:
        hasCacheStats && denominator && denominator > 0
          ? Number(((totalCacheHitTokens / denominator) * 100).toFixed(1))
          : 0
    }
  }

  const buildDoneChunk = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const cacheStats = getAggregatedCacheStats()
    return {
      reqId,
      ...extra,
      done: true,
      tokenSpeed: getTokenSpeed(),
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

    // Declaration cache: the set of tools to declare only changes when activeTools changes
    // (a tool is discovered), so we can avoid rebuilding and re-serialising every step.
    let cachedDeclarations: ChatToolDeclaration[] | null = null
    let cachedDeclarationsSignature = ''

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

      // Build tool declarations list for this step. Rebuild only when the active tool set
      // changes (dynamic mode) or is never cached (static mode: first step only).
      const declarationSig = Array.from(runCtx.activeTools).sort().join(',')
      let toolsToDeclare: ChatToolDeclaration[]
      if (declarationSig !== cachedDeclarationsSignature || cachedDeclarations === null) {
        toolsToDeclare = []
        for (const toolName in ToolRegistry) {
          const tool = ToolRegistry[toolName]
          if (!tool.implemented) continue

          // Whitelist checks depending on toolDiscovery mode
          if (toolDiscovery === 'static') {
            if (!skillTools.includes(toolName)) continue
          } else {
            // Dynamic tool discovery: must be active in current run context
            if (!runCtx.isToolActive(toolName)) continue
          }

          const permission = permissions?.[toolName] || 'allow'
          if (permission !== 'deny') {
            toolsToDeclare.push(toChatToolDeclaration(tool))
          }
        }
        cachedDeclarations = toolsToDeclare
        cachedDeclarationsSignature = declarationSig
      } else {
        toolsToDeclare = cachedDeclarations
      }

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
      let assistantTextBuffer = ''
      const modelStartTime = Date.now()
      const assistantMessage = await callModel(
        {
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          model: options.model
        },
        messages,
        toolsToDeclare,
        signal,
        {
          onReasoning: (content) => {
            sendEvent(mainWindow, reqId, { type: 'reasoning', content, step, stepId })
          },
          onFinalChunk: (content) => {
            assistantTextBuffer += content
            sendEvent(mainWindow, reqId, {
              type: 'agent_message_delta',
              content,
              step,
              stepId
            })
          }
        }
      )
      const modelElapsed = Date.now() - modelStartTime
      const reasoningText = assistantMessage.reasoning_content || ''
      const contentText =
        typeof assistantMessage.content === 'string' ? assistantMessage.content : ''
      totalGeneratedTokens += estimateTokens(reasoningText) + estimateTokens(contentText)
      totalGenerationTimeMs += modelElapsed
      addPromptCacheStats(getPromptCacheStats(assistantMessage))

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
        let stepHadToolFailure = false
        const sendToolErrorEvent = (callId: string, error: string): void => {
          stepHadToolFailure = true
          sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error, step, stepId })
        }
        const sendToolEvents = (events: AgentEvent[]): void => {
          for (const event of events) {
            if (event.type === 'tool_error') {
              sendToolErrorEvent(event.callId, event.error)
            } else {
              sendEvent(mainWindow, reqId, event)
            }
          }
        }

        sendEvent(mainWindow, reqId, {
          type: 'agent_step',
          stepId,
          step,
          maxSteps,
          title: stepPresentation.title,
          message: stepPresentation.message,
          status: 'running'
        })

        const toolModelAttachments = new Array<ToolModelAttachment[] | undefined>(
          assistantMessage.tool_calls.length
        )

        // Helper to execute a single (already-prepared) tool call and return its result message
        const executeTool = async (
          prep: PreparedToolCall,
          isApproved = true
        ): Promise<ChatCompletionMessage> => {
          const { toolName } = prep
          const toolDef = ToolRegistry[toolName]
          const toolStartTime = Date.now()

          const executionResult = await executePreparedToolCall({
            prep,
            tool: toolDef,
            isApproved,
            reqId,
            step,
            maxSteps,
            stepId,
            signal,
            mainWindow,
            resources: options.resources,
            retryPolicy: DEFAULT_RETRY_POLICY,
            isSideEffecting: SIDE_EFFECTING_TOOLS.has(toolName),
            loopGuard,
            outputSpilloverThreshold: TOOL_OUTPUT_SPILLOVER_THRESHOLD,
            activeTools: Array.from(runCtx.activeTools),
            fetchUrlBudget,
            emitEvent: (event) => sendEvent(mainWindow, reqId, event)
          })

          if (executionResult.modelAttachments && executionResult.modelAttachments.length > 0) {
            toolModelAttachments[prep.index] = executionResult.modelAttachments
          }

          if (executionResult.markExecutedCallKey) {
            runCtx.markExecuted(executionResult.markExecutedCallKey)
          }

          if (executionResult.outputStore) {
            runCtx.storeToolOutput(
              executionResult.outputStore.callId,
              executionResult.outputStore.content
            )
            runCtx.activateTool(executionResult.outputStore.activateToolName)
          }

          sendToolEvents(executionResult.events)

          if (executionResult.haltRequested) {
            haltRequested = true
          }

          if (executionResult.ambiguousAction) {
            ambiguousActions.push(executionResult.ambiguousAction)
          }

          recordToolAction({
            actionLog: runCtx.actionLog,
            conversationId,
            reqId,
            turnIndex: step,
            callId: prep.callId,
            toolName: prep.toolName,
            args: prep.args,
            permission: prep.permission,
            status: executionResult.action.resultStatus,
            resultContent: executionResult.action.resultContent,
            outputSpilloverThreshold: TOOL_OUTPUT_SPILLOVER_THRESHOLD,
            startedAt: toolStartTime
          })
          return executionResult.response
        }

        const { toolResponses } = await runPreparedToolBatch({
          toolCallCount: assistantMessage.tool_calls.length,
          askCalls,
          directCalls,
          blockedCalls,
          reqId,
          step,
          stepId,
          signal,
          emitEvent: (event) => sendToolEvents([event]),
          requestPermission: (callId) => globalPermissionManager.requestPermission(reqId, callId),
          isToolApproved: (toolName) => runCtx.isToolApproved(toolName),
          isCommandPrefixApproved: (command) => runCtx.isCommandPrefixApproved(command),
          executeTool
        })

        const finalizedStep = finalizeToolStep({ toolResponses, toolModelAttachments })
        messages.push(...finalizedStep.messagesToAppend)
        persistCheckpoint(step, finalizedStep.lastRecordedCallId)
        sendEvent(mainWindow, reqId, {
          type: 'agent_step_end',
          stepId,
          status: stepHadToolFailure ? 'failed' : 'completed'
        })

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
    const finalModelStartTime = Date.now()
    const forcedFinalMessage = await callModel(
      {
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        model: options.model
      },
      messages,
      undefined,
      signal,
      {
        onReasoning: (content) => {
          sendEvent(mainWindow, reqId, { type: 'reasoning', content })
        },
        onFinalChunk: (content) => {
          forcedFinalEmitted = true
          sendEvent(mainWindow, reqId, { type: 'final', content })
        }
      }
    )
    const finalModelElapsed = Date.now() - finalModelStartTime
    const finalReasoningText = forcedFinalMessage.reasoning_content || ''
    const finalContentText =
      typeof forcedFinalMessage.content === 'string' ? forcedFinalMessage.content : ''
    totalGeneratedTokens += estimateTokens(finalReasoningText) + estimateTokens(finalContentText)
    totalGenerationTimeMs += finalModelElapsed
    addPromptCacheStats(getPromptCacheStats(forcedFinalMessage))

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
