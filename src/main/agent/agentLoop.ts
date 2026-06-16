import { BrowserWindow } from 'electron'
import {
  AgentSkillRunOptions,
  ChatCompletionMessage,
  AgentEvent,
  ChatToolDeclaration,
  SessionResource
} from '../../shared/types'
import { ToolRegistry, toChatToolDeclaration, searchToolDefinitions } from '../toolRegistry'
import { buildSkillMessages, prepareChatAgentMessages } from './messageBuilder'
import {
  getContextWindowSize,
  trimMessagesToFit,
  TOOL_OUTPUT_SPILLOVER_THRESHOLD
} from './contextManager'
import { callModel } from './callModel'
import { estimateTokens } from './tokenEstimator'
import { createRun, destroyRun } from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY, withRetry, isRetryableError } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { ActionLog, getActionLogPath, ActionRecord } from './actionLog'
import { SessionLogger } from './sessionLogger'
import { AmbiguousAction, loadRunCheckpoint, saveRunCheckpoint } from './runCheckpoint'
import {
  appendRunAction,
  appendRunCheckpoint,
  createRunManifest,
  finishRunManifest,
  updateRunManifest
} from './runManifest'
import {
  ACTION_HISTORY_RESUME_LIMIT,
  buildBranchForkPrompt,
  buildCheckpointResumePrompt,
  cloneMessagesForCheckpoint,
  injectPromptBeforeLatestUser
} from './resumePrompts'
import { buildSideEffectEntry, extractResourceIds, SIDE_EFFECTING_TOOLS } from './sideEffects'
import { getFetchUrlCallKey, prepareToolCalls, PreparedToolCall } from './toolCallPlanning'

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

export const runAgentLoop = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: {
    apiUrl: string
    apiKey: string
    model: string
    systemPrompt?: string
    messages?: ChatCompletionMessage[]
    skill?: AgentSkillRunOptions['skill']
    userInput?: string
    resources?: SessionResource[]
    /** Per-conversation id for action-log persistence. Falls back to reqId. */
    sessionId?: string
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
  const skillTools = isSkill ? options.skill!.tools || [] : []
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
      permissions
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
    options.sessionId
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

  let fetchUrlsCount = 0
  const MAX_FETCH_URLS_PER_RUN = 10
  let totalGeneratedTokens = 0
  let totalGenerationTimeMs = 0

  const getTokenSpeed = (): number => {
    const totalGenerationSec = totalGenerationTimeMs / 1000
    return totalGenerationSec > 0 ? Number((totalGeneratedTokens / totalGenerationSec).toFixed(1)) : 0
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
      const contextSize = getContextWindowSize(options.model)
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
      const contentText = typeof assistantMessage.content === 'string' ? assistantMessage.content : ''
      totalGeneratedTokens += estimateTokens(reasoningText) + estimateTokens(contentText)
      totalGenerationTimeMs += modelElapsed

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
          loopGuard
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

        sendEvent(mainWindow, reqId, {
          type: 'agent_step',
          stepId,
          step,
          maxSteps,
          title: stepPresentation.title,
          message: stepPresentation.message,
          status: 'running'
        })

        const toolResponses = new Array<ChatCompletionMessage>(assistantMessage.tool_calls.length)

        // Helper to execute a single (already-prepared) tool call and return its result message
        const executeTool = async (
          prep: PreparedToolCall,
          isApproved = true
        ): Promise<ChatCompletionMessage> => {
          const { toolName, callId, args: toolArgs } = prep
          const toolDef = ToolRegistry[toolName]
          const toolStartTime = Date.now()

          const recordAction = (
            status: ActionRecord['resultStatus'],
            resultContent: string
          ): void => {
            const resourceIds = extractResourceIds(resultContent)
            runCtx.actionLog.append({
              callId: prep.callId,
              reqId,
              turnIndex: step,
              timestamp: Date.now(),
              toolName: prep.toolName,
              args: prep.args as Record<string, unknown>,
              resultStatus: status,
              resultSummary: resultContent.slice(0, 500),
              resultSize: resultContent.length,
              resultInOutputStore: resultContent.length > TOOL_OUTPUT_SPILLOVER_THRESHOLD,
              permission: prep.permission,
              durationMs: Date.now() - toolStartTime
            })
            const sideEffect = buildSideEffectEntry(
              reqId,
              prep.callId,
              prep.toolName,
              prep.args,
              status,
              resultContent
            )
            appendRunAction(conversationId, reqId, prep.callId, sideEffect)
            if (resourceIds.length > 0) {
              // Resource ids are also tracked in renderer session state; the manifest keeps a
              // run-local ledger so branch/delete semantics do not have to infer from messages.
              updateRunManifest(conversationId, reqId, (manifest) => ({
                ...manifest,
                resourceIds: Array.from(new Set([...manifest.resourceIds, ...resourceIds]))
              }))
            }
            SessionLogger.logToolExecution(
              conversationId,
              prep.callId,
              prep.toolName,
              prep.args as Record<string, unknown>,
              prep.permission,
              status,
              Date.now() - toolStartTime,
              resultContent
            )
          }

          if (!prep.isValid || prep.permission === 'deny') {
            const errorMsg =
              prep.blockReason ||
              `Tool execution blocked: Tool "${toolName}" is not registered, not implemented, not whitelisted/activated, or denied by policy.`
            sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId,
              toolName,
              args: toolArgs,
              purpose: prep.purpose,
              permissionState: 'denied',
              step,
              stepId
            })
            sendToolErrorEvent(callId, errorMsg)
            const content = `Error: ${errorMsg}`
            recordAction('denied', content)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content
            }
          }

          if (prep.isDeadlock) {
            const offset = typeof toolArgs.offset === 'number' ? toolArgs.offset : 0
            const deadlockWarning = `Warning: You have already fetched this URL window: ${toolArgs.url} at offset ${offset}. Use the nextOffset from the previous result to continue.`
            sendToolErrorEvent(callId, deadlockWarning)
            recordAction('blocked', deadlockWarning)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: deadlockWarning
            }
          }

          if (prep.loopBlock) {
            sendToolErrorEvent(callId, prep.loopBlock)
            recordAction('blocked', prep.loopBlock)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: prep.loopBlock
            }
          }

          if (toolName === 'fetch_url') {
            if (fetchUrlsCount >= MAX_FETCH_URLS_PER_RUN) {
              const limitWarning = `Warning: You have reached the maximum fetch limit of ${MAX_FETCH_URLS_PER_RUN} page windows for this run. Please summarize based only on the content you already have.`
              sendToolErrorEvent(callId, limitWarning)
              recordAction('blocked', limitWarning)
              return {
                role: 'tool',
                tool_call_id: callId,
                name: toolName,
                content: limitWarning
              }
            }
            if (isApproved) {
              fetchUrlsCount++
            }
          }

          if (!isApproved) {
            const errorMsg = 'Tool execution denied by user.'
            sendToolErrorEvent(callId, errorMsg)
            const content = `ERROR: ${errorMsg}`
            recordAction('denied', content)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content
            }
          }

          // Execute tool with retry policy
          try {
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }
            const { resultForModel, resultForUi } = await withRetry(
              () => toolDef.execute(toolArgs, { reqId, signal, mainWindow }),
              DEFAULT_RETRY_POLICY,
              signal
            )
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }

            if (toolName === 'fetch_url') {
              const callKey = getFetchUrlCallKey(toolArgs)
              if (callKey) {
                runCtx.markExecuted(callKey)
              }
            }

            loopGuard.recordSuccess(toolName)

            // Preserve large outputs so a later context-window truncation can leave a retrievable
            // pointer (read_tool_output) instead of silently discarding the tail.
            if (resultForModel.length > TOOL_OUTPUT_SPILLOVER_THRESHOLD) {
              runCtx.storeToolOutput(callId, resultForModel)
              runCtx.activateTool('read_tool_output')
            }

            sendEvent(mainWindow, reqId, {
              type: 'tool_result',
              callId,
              result: resultForUi,
              step,
              stepId
            })

            sendEvent(mainWindow, reqId, {
              type: 'agent_progress',
              step,
              maxSteps,
              stepId,
              activeTools: Array.from(runCtx.activeTools),
              message: `Completed ${toolName}`
            })

            recordAction('success', resultForModel)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: resultForModel
            }
          } catch (error) {
            const err = error as Error
            const interrupted =
              signal.aborted ||
              err.name === 'AbortError' ||
              err.message.toLowerCase().includes('aborted') ||
              err.message.toLowerCase().includes('cancelled')
            const isAmbiguousSideEffect = SIDE_EFFECTING_TOOLS.has(toolName) && interrupted
            const errorCategory = isAmbiguousSideEffect
              ? '[Ambiguous Side Effect - inspect state before repeating]'
              : isRetryableError(err, DEFAULT_RETRY_POLICY)
                ? '[Transient Error - retries exhausted]'
                : '[Permanent Error - do not retry this action]'

            // Track consecutive failures of this tool. Repeated failures first nudge the model,
            // then halt the turn so we return a best-effort answer instead of looping.
            const failure = loopGuard.recordFailure(toolName)
            let guardNote = ''
            if (failure.level === 'halt') {
              haltRequested = true
              guardNote = ` [Loop guard: "${toolName}" failed ${failure.count} times in a row; halting tool use and forcing a final answer.]`
            } else if (failure.level === 'warn') {
              guardNote = ` [Loop guard: "${toolName}" has failed ${failure.count} times in a row; try a different approach or tool.]`
            }

            const errorContent = `${errorCategory} ${err.message}${guardNote}`
            sendToolErrorEvent(callId, err.message)
            if (isAmbiguousSideEffect) {
              ambiguousActions.push({
                callId,
                toolName,
                args: toolArgs,
                reason: errorContent,
                timestamp: Date.now()
              })
            }
            recordAction(isAmbiguousSideEffect ? 'ambiguous' : 'error', errorContent)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: errorContent
            }
          }
        }

        // 1. Process askCalls sequentially
        for (const prep of askCalls) {
          if (signal.aborted) break
          const { index, toolName, callId, args: toolArgs } = prep

          // Check if this tool call has been approved in the meantime
          // (e.g. from a previous confirmation in this parallel batch)
          let isApproved = false
          const isToolApproved = runCtx.isToolApproved(toolName)
          const isCmdApproved =
            toolName === 'shell' &&
            typeof toolArgs.command === 'string' &&
            runCtx.isCommandPrefixApproved(toolArgs.command)

          if (isToolApproved || isCmdApproved) {
            isApproved = true
          } else {
            // Emit tool_call event with pending permission state
            sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId,
              toolName,
              args: toolArgs,
              purpose: prep.purpose,
              permissionState: 'pending',
              step,
              stepId
            })

            try {
              isApproved = await globalPermissionManager.requestPermission(reqId, callId)
            } catch (err) {
              const error = err as Error
              sendEvent(mainWindow, reqId, {
                type: 'tool_call',
                callId,
                toolName,
                args: toolArgs,
                purpose: prep.purpose,
                permissionState: 'denied',
                step,
                stepId
              })
              sendToolErrorEvent(callId, error.message)
              toolResponses[index] = {
                role: 'tool',
                tool_call_id: callId,
                name: toolName,
                content: `ERROR: ${error.message}`
              }
              if (signal.aborted) {
                break
              }
              continue
            }
          }

          sendEvent(mainWindow, reqId, {
            type: 'tool_call',
            callId,
            toolName,
            args: toolArgs,
            purpose: prep.purpose,
            permissionState: isApproved ? 'approved' : 'denied',
            step,
            stepId
          })

          toolResponses[index] = await executeTool(prep, isApproved)
        }

        if (signal.aborted) {
          throw new Error('Agent execution aborted by user.')
        }

        // 2. Process directCalls concurrently (validated and allowed)
        await Promise.all(
          directCalls.map(async (prep) => {
            // Emit tool_call event
             sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId: prep.callId,
              toolName: prep.toolName,
              args: prep.args,
              purpose: prep.purpose,
              permissionState: 'approved',
              step,
              stepId
            })

            toolResponses[prep.index] = await executeTool(prep, true)
          })
        )

        // 3. Process blockedCalls concurrently (no permission request, immediately run executeTool which blocks/denies it)
        await Promise.all(
          blockedCalls.map(async (prep) => {
            toolResponses[prep.index] = await executeTool(prep, false)
          })
        )

        // 4. Append all responses in correct index order to messages array
        for (const response of toolResponses) {
          if (response) {
            messages.push(response)
          }
        }
        const lastRecordedCallId = [...toolResponses]
          .reverse()
          .find((response): response is ChatCompletionMessage => !!response)?.tool_call_id
        persistCheckpoint(step, lastRecordedCallId)
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
        mainWindow.webContents.send('chat-chunk', { reqId, done: true, tokenSpeed: getTokenSpeed() })
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
    const contextSize = getContextWindowSize(options.model)
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
    const finalContentText = typeof forcedFinalMessage.content === 'string' ? forcedFinalMessage.content : ''
    totalGeneratedTokens += estimateTokens(finalReasoningText) + estimateTokens(finalContentText)
    totalGenerationTimeMs += finalModelElapsed

    const forcedFinalText = getAssistantText(forcedFinalMessage.content)
    if (!forcedFinalEmitted && forcedFinalText) {
      sendEvent(mainWindow, reqId, { type: 'final', content: forcedFinalText })
    }

    setRunEnd('max_steps')
    mainWindow.webContents.send('chat-chunk', { reqId, done: true, tokenSpeed: getTokenSpeed() })
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    const isAborted =
      signal.aborted || err.message?.includes('aborted') || err.name === 'AbortError'
    if (isAborted) {
      setRunEnd('cancelled')
      mainWindow.webContents.send('chat-chunk', { reqId, cancelled: true, done: true, tokenSpeed: getTokenSpeed() })
    } else {
      setRunEnd('failed', err.message || 'Agent Loop failed')
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        error: err.message || 'Agent Loop failed'
      })
      mainWindow.webContents.send('chat-chunk', { reqId, done: true, tokenSpeed: getTokenSpeed() })
    }
  } finally {
    actionLog.save()
    destroyRun(reqId)
  }
}
