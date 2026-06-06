import { BrowserWindow } from 'electron'
import {
  AgentSkillRunOptions,
  ChatCompletionMessage,
  AgentEvent,
  ToolArgs,
  ChatToolDeclaration
} from '../../shared/types'
import { ToolRegistry, toChatToolDeclaration } from '../toolRegistry'
import { buildSkillMessages, prepareChatAgentMessages } from './messageBuilder'
import { getContextWindowSize, trimMessagesToFit } from './contextManager'
import { callModel } from './callModel'
import { createRun, destroyRun } from './AgentRunContext'
import { globalPermissionManager } from './permissionManager'
import { DEFAULT_RETRY_POLICY, withRetry, isRetryableError } from './retryPolicy'

const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 5
  return Math.max(1, Math.min(8, Math.floor(value)))
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
  },
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  const isSkill = !!options.skill
  const toolDiscovery = isSkill
    ? options.skill!.toolDiscovery === 'dynamic'
      ? 'dynamic'
      : 'static'
    : 'dynamic'

  const maxSteps = isSkill ? clampMaxSteps(options.skill!.maxSteps) : 8
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
      userInput: options.userInput || ''
    })
  } else {
    messages = prepareChatAgentMessages(options.messages || [], options.systemPrompt)
  }

  // Initialize Run Context
  const initialActiveTools = toolDiscovery === 'dynamic' ? ['search_tools'] : skillTools
  const runCtx = createRun(reqId, initialActiveTools, toolScope, permissions)
  const signal = runCtx.signal

  try {
    sendEvent(mainWindow, reqId, {
      type: 'agent_start',
      skillName: isSkill ? options.skill!.name : 'General Agent'
    })

    for (let step = 1; step <= maxSteps; ) {
      if (signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      // Build tool declarations list for this step
      const toolsToDeclare: ChatToolDeclaration[] = []

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
        // Pre-scan for deadlocks (especially duplicate URL fetching)
        // Use a Set of indices to avoid mutating tool_call objects in the messages array
        const deadlockIndices = new Set<number>()
        assistantMessage.tool_calls.forEach((toolCall, index) => {
          const toolName = toolCall.function.name
          const permission = permissions?.[toolName] || 'allow'

          const toolDef = ToolRegistry[toolName]
          let isWhitelisted = false
          if (toolDiscovery === 'static') {
            isWhitelisted = skillTools.includes(toolName)
          } else {
            isWhitelisted = runCtx.isToolActive(toolName)
          }

          const isValid = toolDef && toolDef.implemented && isWhitelisted
          const isBlocked = !isValid || permission === 'deny'

          if (!isBlocked && toolName === 'fetch_url') {
            let toolArgs: ToolArgs = {}
            try {
              toolArgs = JSON.parse(toolCall.function.arguments) as ToolArgs
            } catch {
              // ignore
            }
            const url = (toolArgs.url as string) || ''
            if (url) {
              const callKey = `${toolName}:${url}`
              if (runCtx.hasExecuted(callKey)) {
                deadlockIndices.add(index)
              } else {
                runCtx.markExecuted(callKey)
              }
            }
          }
        })

        // Separate tool calls into serial (ask), parallel (allow/direct), and blocked (invalid/deny)
        interface ToolCallItem {
          index: number
          toolCall: (typeof assistantMessage.tool_calls)[0]
        }

        const askCalls: ToolCallItem[] = []
        const directCalls: ToolCallItem[] = []
        const blockedCalls: ToolCallItem[] = []

        assistantMessage.tool_calls.forEach((toolCall, index) => {
          const toolName = toolCall.function.name
          const permission = permissions?.[toolName] || 'allow'

          const toolDef = ToolRegistry[toolName]
          let isWhitelisted = false
          if (toolDiscovery === 'static') {
            isWhitelisted = skillTools.includes(toolName)
          } else {
            isWhitelisted = runCtx.isToolActive(toolName)
          }

          const isValid = toolDef && toolDef.implemented && isWhitelisted

          if (deadlockIndices.has(index)) {
            // Deadlocks bypass permissions and are handled directly in executeTool
            directCalls.push({ index, toolCall })
          } else if (!isValid || permission === 'deny') {
            blockedCalls.push({ index, toolCall })
          } else if (permission === 'ask') {
            askCalls.push({ index, toolCall })
          } else {
            directCalls.push({ index, toolCall })
          }
        })

        const toolResponses = new Array<ChatCompletionMessage>(assistantMessage.tool_calls.length)

        // Helper to execute a single tool call and return its result message
        const executeTool = async (
          toolCall: (typeof assistantMessage.tool_calls)[0],
          toolIndex: number,
          isApproved = true
        ): Promise<ChatCompletionMessage> => {
          const toolName = toolCall.function.name
          const callId = toolCall.id

          let toolArgs: ToolArgs = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as ToolArgs
          } catch {
            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
          }

          const toolDef = ToolRegistry[toolName]
          const permission = permissions?.[toolName] || 'allow'

          let isWhitelisted = false
          if (toolDiscovery === 'static') {
            isWhitelisted = skillTools.includes(toolName)
          } else {
            isWhitelisted = runCtx.isToolActive(toolName)
          }

          // Check deadlock via index set (avoids mutating tool_call objects)
          if (deadlockIndices.has(toolIndex)) {
            const deadlockWarning = `Warning: You have already fetched the URL: ${toolArgs.url}. Fetching it again will not yield new information.`
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: deadlockWarning })
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: deadlockWarning
            }
          }

          if (!toolDef || !toolDef.implemented || !isWhitelisted || permission === 'deny') {
            const errorMsg = `Tool execution blocked: Tool "${toolName}" is not registered, not implemented, not whitelisted/activated, or denied by policy.`
            sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId,
              toolName,
              args: toolArgs,
              permissionState: 'denied'
            })
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `Error: ${errorMsg}`
            }
          }

          if (!isApproved) {
            const errorMsg = 'Tool execution denied by user.'
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `ERROR: ${errorMsg}`
            }
          }

          // Execute tool with retry policy
          try {
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }
            const { resultForModel, resultForUi } = await withRetry(
              () => toolDef.execute(toolArgs, { reqId, signal }),
              DEFAULT_RETRY_POLICY,
              signal
            )
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }

            sendEvent(mainWindow, reqId, {
              type: 'tool_result',
              callId,
              result: resultForUi
            })

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
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: err.message })
            return {
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `${errorCategory} ${err.message}`
            }
          }
        }

        // 1. Process askCalls sequentially
        for (const { index, toolCall } of askCalls) {
          const toolName = toolCall.function.name
          const callId = toolCall.id

          let toolArgs: ToolArgs = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as ToolArgs
          } catch {
            // ignore
          }

          // Emit tool_call event with pending permission state
          sendEvent(mainWindow, reqId, {
            type: 'tool_call',
            callId,
            toolName,
            args: toolArgs,
            permissionState: 'pending'
          })

          let isApproved = false
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
            continue
          }

          sendEvent(mainWindow, reqId, {
            type: 'tool_call',
            callId,
            toolName,
            args: toolArgs,
            permissionState: isApproved ? 'approved' : 'denied'
          })

          toolResponses[index] = await executeTool(toolCall, index, isApproved)
        }

        // 2. Process directCalls concurrently (validated and allowed)
        await Promise.all(
          directCalls.map(async ({ index, toolCall }) => {
            const toolName = toolCall.function.name
            const callId = toolCall.id

            let toolArgs: ToolArgs = {}
            try {
              toolArgs = JSON.parse(toolCall.function.arguments) as ToolArgs
            } catch {
              // ignore
            }

            // Emit tool_call event
            sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId,
              toolName,
              args: toolArgs,
              permissionState: 'approved'
            })

            toolResponses[index] = await executeTool(toolCall, index, true)
          })
        )

        // 3. Process blockedCalls concurrently (no permission request, immediately run executeTool which blocks/denies it)
        await Promise.all(
          blockedCalls.map(async ({ index, toolCall }) => {
            toolResponses[index] = await executeTool(toolCall, index, false)
          })
        )

        // 3. Append all responses in correct index order to messages array
        for (const response of toolResponses) {
          if (response) {
            messages.push(response)
          }
        }

        step++
      } else {
        mainWindow.webContents.send('chat-chunk', { reqId, done: true })
        return
      }
    }

    // Maximum steps reached without final answer: request final summary
    messages.push({
      role: 'user',
      content:
        'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
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

    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Loop failed' })
  } finally {
    destroyRun(reqId)
  }
}
