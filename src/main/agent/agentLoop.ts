import { BrowserWindow } from 'electron'
import {
  AgentSkillRunOptions,
  ChatCompletionMessage,
  AgentEvent,
  ToolArgs,
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
import { createRun, destroyRun } from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY, withRetry, isRetryableError } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { evaluateToolGuard } from './constitution'
import { ActionLog, getActionLogPath, ActionRecord } from './actionLog'

const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 30
  return Math.max(1, Math.min(30, Math.floor(value)))
}

const getFetchUrlCallKey = (toolArgs: ToolArgs): string | undefined => {
  const url = typeof toolArgs.url === 'string' ? toolArgs.url : ''
  if (!url) return undefined

  const rawOffset = typeof toolArgs.offset === 'number' ? toolArgs.offset : 0
  const rawMaxChars = typeof toolArgs.maxChars === 'number' ? toolArgs.maxChars : undefined
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
  const maxChars =
    rawMaxChars !== undefined && Number.isFinite(rawMaxChars)
      ? Math.min(16000, Math.max(1000, Math.floor(rawMaxChars)))
      : 'default'

  return `fetch_url:${url}:offset=${offset}:maxChars=${maxChars}`
}

const sendEvent = (mainWindow: BrowserWindow, reqId: string, event: AgentEvent): void => {
  mainWindow.webContents.send('chat-chunk', { reqId, event })
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

  // Prepare messages history
  let messages: ChatCompletionMessage[] = []
  if (isSkill) {
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

  // Per-conversation action log: persists tool call history across runs so the model can
  // consult what it did earlier in the same conversation, even after context truncation.
  const conversationId = options.sessionId || reqId
  const actionLog = new ActionLog(getActionLogPath(conversationId))

  // Initialize Run Context
  const initialActiveTools = toolDiscovery === 'dynamic' ? ['search_tools'] : skillTools
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
  const runCtx = createRun(reqId, initialActiveTools, toolScope, actionLog, permissions)
  runCtx.maxSteps = maxSteps
  const signal = runCtx.signal

  let fetchUrlsCount = 0
  const MAX_FETCH_URLS_PER_RUN = 10

  // Behavioural guardrails (repeated-call blocking + consecutive-failure halt) that
  // complement the hard maxSteps ceiling. Scoped to this run.
  const loopGuard = new LoopGuard()
  let haltRequested = false

  const setRunEnd = (
    status: 'completed' | 'cancelled' | 'failed' | 'max_steps',
    error?: string
  ): void => {
    runCtx.status = status
    runCtx.completedAt = Date.now()
    if (error) {
      runCtx.error = error
    }
    sendEvent(mainWindow, reqId, {
      type: 'agent_end',
      status,
      error
    })
  }

  try {
    sendEvent(mainWindow, reqId, {
      type: 'agent_start',
      skillName: isSkill ? options.skill!.name : 'General Agent'
    })

    // Declaration cache: the set of tools to declare only changes when activeTools changes
    // (a tool is discovered), so we can avoid rebuilding and re-serialising every step.
    let cachedDeclarations: ChatToolDeclaration[] | null = null
    let cachedDeclarationsSignature = ''

    for (let step = 1; step <= maxSteps; ) {
      runCtx.currentStep = step
      if (signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      sendEvent(mainWindow, reqId, {
        type: 'agent_progress',
        step,
        maxSteps,
        activeTools: Array.from(runCtx.activeTools)
      })

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

      // Call the model with streaming callbacks
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
            sendEvent(mainWindow, reqId, { type: 'reasoning', content })
          },
          onFinalChunk: (content) => {
            sendEvent(mainWindow, reqId, { type: 'final', content })
          }
        }
      )

      messages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        type RawToolCall = (typeof assistantMessage.tool_calls)[number]

        // Single source of truth for the whitelist check (was previously duplicated in three
        // places, each of which had to be kept in sync by hand).
        const isToolWhitelisted = (toolName: string): boolean =>
          toolDiscovery === 'static' ? skillTools.includes(toolName) : runCtx.isToolActive(toolName)

        // A tool call resolved once: arguments parsed a single time, validity/permission
        // computed once, classification decided once. Everything downstream reads these fields
        // instead of recomputing them.
        interface PreparedCall {
          index: number
          toolCall: RawToolCall
          toolName: string
          callId: string
          args: ToolArgs
          permission: 'allow' | 'ask' | 'deny'
          isValid: boolean
          isDeadlock: boolean
          /** Set when the loop guard blocks this call; answered with this message, never executed. */
          loopBlock?: string
          /** Set when a guardrail escalates/blocks this call; surfaced to the model on block. */
          blockReason?: string
          classification: 'ask' | 'direct' | 'blocked'
        }

        // Tracks duplicate fetch_url windows emitted within this same turn.
        const seenFetchCallsThisTurn = new Set<string>()

        const prepared: PreparedCall[] = assistantMessage.tool_calls.map((toolCall, index) => {
          const toolName = toolCall.function.name
          const callId = toolCall.id
          const permission = permissions?.[toolName] || 'allow'

          let args: ToolArgs = {}
          try {
            args = JSON.parse(toolCall.function.arguments) as ToolArgs
          } catch {
            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
          }

          const toolDef = ToolRegistry[toolName]
          const isValid = !!toolDef && toolDef.implemented && isToolWhitelisted(toolName)

          // Guardrail: inspect the actual arguments and escalate the static permission
          // (allow -> ask -> deny) when they cross a danger boundary. Never weakens it.
          let effectivePermission = permission
          let blockReason: string | undefined
          if (isValid && permission !== 'deny' && toolDef) {
            const verdict = evaluateToolGuard(toolName, args, permission, toolDef.risk)
            effectivePermission = verdict.action
            if (verdict.action !== permission && verdict.reason) {
              blockReason = verdict.reason
            }
          }

          if (effectivePermission === 'ask') {
            if (runCtx.isToolApproved(toolName)) {
              effectivePermission = 'allow'
            } else if (
              toolName === 'shell' &&
              typeof args.command === 'string' &&
              runCtx.isCommandPrefixApproved(args.command)
            ) {
              effectivePermission = 'allow'
            }
          }

          // Detect duplicate fetch_url windows (same url+offset+maxChars) seen earlier in this
          // run or earlier in this same turn. Deadlocks bypass permissions and are answered with
          // a warning inside executeTool.
          let isDeadlock = false
          if (isValid && effectivePermission !== 'deny' && toolName === 'fetch_url') {
            const callKey = getFetchUrlCallKey(args)
            if (callKey) {
              if (runCtx.hasExecuted(callKey) || seenFetchCallsThisTurn.has(callKey)) {
                isDeadlock = true
              } else {
                seenFetchCallsThisTurn.add(callKey)
              }
            }
          }

          let classification: 'ask' | 'direct' | 'blocked'
          let loopBlock: string | undefined
          if (isDeadlock) {
            classification = 'direct'
          } else if (!isValid || effectivePermission === 'deny') {
            classification = 'blocked'
          } else {
            // Executable call: apply the identical-call loop guard before routing it for
            // permission/execution. A blocked repeat is answered with a warning and never run.
            const repeat = loopGuard.recordCall(loopGuard.signature(toolName, args))
            if (repeat.blocked) {
              loopBlock = `Loop guard: "${toolName}" has been called with identical arguments ${repeat.count} times in this run. The previous result still applies — do not repeat this call; use that result, change the arguments, or try a different approach.`
              classification = 'direct'
            } else if (effectivePermission === 'ask') {
              classification = 'ask'
            } else {
              classification = 'direct'
            }
          }

          return {
            index,
            toolCall,
            toolName,
            callId,
            args,
            permission: effectivePermission,
            isValid,
            isDeadlock,
            loopBlock,
            blockReason,
            classification
          }
        })

        const askCalls = prepared.filter((p) => p.classification === 'ask')
        const directCalls = prepared.filter((p) => p.classification === 'direct')
        const blockedCalls = prepared.filter((p) => p.classification === 'blocked')

        const toolResponses = new Array<ChatCompletionMessage>(assistantMessage.tool_calls.length)

        // Helper to execute a single (already-prepared) tool call and return its result message
        const executeTool = async (
          prep: PreparedCall,
          isApproved = true
        ): Promise<ChatCompletionMessage> => {
          const { toolName, callId, args: toolArgs } = prep
          const toolDef = ToolRegistry[toolName]
          const toolStartTime = Date.now()

          const recordAction = (
            status: ActionRecord['resultStatus'],
            resultContent: string
          ): void => {
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
              permissionState: 'denied'
            })
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
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
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: deadlockWarning })
            recordAction('blocked', deadlockWarning)
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: deadlockWarning
            }
          }

          if (prep.loopBlock) {
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: prep.loopBlock })
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
              sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: limitWarning })
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
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
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
              result: resultForUi
            })

            sendEvent(mainWindow, reqId, {
              type: 'agent_progress',
              step,
              maxSteps,
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
            const errorCategory = isRetryableError(err, DEFAULT_RETRY_POLICY)
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
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: err.message })
            recordAction('error', errorContent)
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
              permissionState: 'pending'
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
                permissionState: 'denied'
              })
              sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: error.message })
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
            permissionState: isApproved ? 'approved' : 'denied'
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
              permissionState: 'approved'
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

        // A loop-guard halt ends tool use immediately; fall through to the final-answer path.
        if (haltRequested) {
          break
        }

        step++
      } else {
        setRunEnd('completed')
        mainWindow.webContents.send('chat-chunk', { reqId, done: true })
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

    await callModel(
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
          sendEvent(mainWindow, reqId, { type: 'final', content })
        }
      }
    )

    setRunEnd('max_steps')
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    const isAborted =
      signal.aborted || err.message?.includes('aborted') || err.name === 'AbortError'
    if (isAborted) {
      setRunEnd('cancelled')
      mainWindow.webContents.send('chat-chunk', { reqId, cancelled: true, done: true })
    } else {
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        error: err.message || 'Agent Loop failed'
      })
      setRunEnd('failed', err.message || 'Agent Loop failed')
      mainWindow.webContents.send('chat-chunk', { reqId, done: true })
    }
  } finally {
    actionLog.save()
    destroyRun(reqId)
  }
}
