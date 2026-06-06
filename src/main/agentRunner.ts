import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatCompletionMessage, AgentEvent, ToolArgs, ChatToolDeclaration, ChatRunOptions } from '../shared/types'
import { ToolRegistry, searchToolDefinitions, toChatToolDeclaration } from './toolRegistry'

const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 5
  return Math.max(1, Math.min(8, Math.floor(value)))
}

const sendEvent = (mainWindow: BrowserWindow, reqId: string, event: AgentEvent): void => {
  mainWindow.webContents.send('chat-chunk', { reqId, event })
}

// Map to hold pending permission resolvers/rejecters
interface PendingPermissionPromise {
  resolve: (approved: boolean) => void
  reject: (err: Error) => void
  timeoutId: NodeJS.Timeout
}

const pendingPermissions = new Map<string, PendingPermissionPromise>()

// Map to hold active agent runs AbortControllers
export const activeAgentRuns = new Map<string, AbortController>()

export const abortAgentSkill = (reqId: string): void => {
  const controller = activeAgentRuns.get(reqId)
  if (controller) {
    controller.abort()
    activeAgentRuns.delete(reqId)
  }
}

// Helper to resolve/reject a pending permission request
export const resolveToolPermission = (reqId: string, callId: string, approved: boolean): void => {
  const key = `${reqId}:${callId}`
  const pending = pendingPermissions.get(key)
  if (pending) {
    clearTimeout(pending.timeoutId)
    pendingPermissions.delete(key)
    pending.resolve(approved)
  }
}

// Helper to clean up all pending permissions for a specific run (reqId)
const cleanupPendingPermissionsForRun = (reqId: string): void => {
  for (const [key, pending] of pendingPermissions.entries()) {
    if (key.startsWith(`${reqId}:`)) {
      clearTimeout(pending.timeoutId)
      pendingPermissions.delete(key)
      pending.reject(new Error('Agent run terminated or aborted.'))
    }
  }
}

const callModel = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: {
    apiUrl: string
    apiKey: string
    model: string
    systemPrompt?: string
  },
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal
): Promise<ChatCompletionMessage> => {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  // Sanitize messages to strip reasoning_content from assistant messages (causes issues on OpenAI-compatible APIs)
  const sanitizedMessages = messages.map((m) => {
    if (m.role === 'assistant') {
      const copy = { ...m }
      delete copy.reasoning_content
      return copy
    }
    return m
  })

  const body: Record<string, unknown> = {
    model: options.model,
    messages: sanitizedMessages,
    stream: true
  }

  if (toolsToDeclare && toolsToDeclare.length > 0) {
    body.tools = toolsToDeclare
    body.tool_choice = 'auto'
  }

  const response = await fetch(completionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Failed to get readable stream reader')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const shouldStreamFinal = !toolsToDeclare || toolsToDeclare.length === 0

  const assistantMessage: ChatCompletionMessage = {
    role: 'assistant',
    content: '',
    reasoning_content: '',
    tool_calls: []
  }

  let inThinkTag = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const cleanLine = line.trim()
      if (!cleanLine) continue
      if (cleanLine === 'data: [DONE]') continue

      if (cleanLine.startsWith('data: ')) {
        try {
          const json = JSON.parse(cleanLine.substring(6))
          const delta = json.choices?.[0]?.delta
          if (!delta) continue

          // 1. Stream cloud model reasoning_content
          if (delta.reasoning_content) {
            assistantMessage.reasoning_content += delta.reasoning_content
            sendEvent(mainWindow, reqId, { type: 'reasoning', content: delta.reasoning_content })
          }

          // 2. Stream tool calls
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index
              if (!assistantMessage.tool_calls) assistantMessage.tool_calls = []
              if (!assistantMessage.tool_calls[idx]) {
                assistantMessage.tool_calls[idx] = {
                  id: tcDelta.id || '',
                  type: 'function',
                  function: { name: tcDelta.function?.name || '', arguments: '' }
                }
              }
              if (tcDelta.id) {
                assistantMessage.tool_calls[idx].id = tcDelta.id
              }
              if (tcDelta.function?.name) {
                assistantMessage.tool_calls[idx].function.name = tcDelta.function.name
              }
              if (tcDelta.function?.arguments) {
                assistantMessage.tool_calls[idx].function.arguments += tcDelta.function.arguments
              }
            }
          }

          // 3. Stream text content (handling local <think> tags on the fly)
          if (delta.content) {
            let contentChunk = delta.content

            if (contentChunk.includes('<think>')) {
              inThinkTag = true
              const parts = contentChunk.split('<think>')
              if (parts[0]) {
                if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                assistantMessage.content += parts[0]
                if (shouldStreamFinal) {
                  sendEvent(mainWindow, reqId, { type: 'final', content: parts[0] })
                }
              }
              contentChunk = parts.slice(1).join('<think>')
            }

            if (inThinkTag) {
              if (contentChunk.includes('</think>')) {
                inThinkTag = false
                const parts = contentChunk.split('</think>')
                if (parts[0]) {
                  assistantMessage.reasoning_content += parts[0]
                  sendEvent(mainWindow, reqId, { type: 'reasoning', content: parts[0] })
                }
                if (parts[1]) {
                  if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
                  assistantMessage.content += parts[1]
                  if (shouldStreamFinal) {
                    sendEvent(mainWindow, reqId, { type: 'final', content: parts[1] })
                  }
                }
              } else {
                assistantMessage.reasoning_content += contentChunk
                sendEvent(mainWindow, reqId, { type: 'reasoning', content: contentChunk })
              }
            } else {
              if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
              assistantMessage.content += contentChunk
              if (shouldStreamFinal) {
                sendEvent(mainWindow, reqId, { type: 'final', content: contentChunk })
              }
            }
          }
        } catch {
          // JSON parse error
        }
      }
    }
  }

  if (assistantMessage.tool_calls) {
    assistantMessage.tool_calls = assistantMessage.tool_calls.filter(
      (tc) => tc && tc.function?.name
    )
  }

  if (!shouldStreamFinal) {
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (typeof assistantMessage.content === 'string' && assistantMessage.content) {
        sendEvent(mainWindow, reqId, { type: 'final', content: assistantMessage.content })
      }
    }
  }

  return assistantMessage
}

const buildAgentMessages = (options: AgentSkillRunOptions): ChatCompletionMessage[] => {
  const skillMarkdown = options.skill.rawMarkdown || options.skill.prompt
  const baseSystemPrompt = options.systemPrompt
    ? `User global system prompt:\n${options.systemPrompt}\n\n`
    : ''

  return [
    {
      role: 'system',
      content: `${baseSystemPrompt}You are QuickAI Agent Runner. Execute the installed Skill by reading its SKILL.md instructions.

You have access to tools that you can call.
Rules:
- Read the SKILL.md as the operating manual.
- If the Skill describes URL templates, infer the right keyword and fill the URL yourself.
- Prefer authoritative and relevant pages.
- Do not invent sources.
- If observations are insufficient, say so in the final answer.
- Stop when you can answer the user question. Write your final answer in Markdown.`
    },
    {
      role: 'user',
      content: `Installed SKILL.md:\n\n${skillMarkdown}\n\nUser request:\n${options.userInput}`
    }
  ]
}

export const activeToolsByRun = new Map<string, Set<string>>()

const prepareChatAgentMessages = (
  messages: ChatCompletionMessage[],
  globalSystemPrompt?: string
): ChatCompletionMessage[] => {
  const agentInstructions = `You are QuickAI General Agent. You have access to tools that you can discover and execute dynamically.

Rules:
- If you need to search or fetch external web data, or execute local file operations, you must first search for available tools by calling "search_tools".
- You can search for tools by keywords (e.g. "web search" or "file read").
- Only call tools that are whitelisted and returned by "search_tools" in a prior turn.
- If observations are insufficient, say so in the final answer.
- Stop when you can answer the user question directly. Write your final answer in Markdown.`

  const copy = messages.map((m) => ({ ...m }))
  const systemMsg = copy.find((m) => m.role === 'system')

  if (systemMsg) {
    systemMsg.content = `${globalSystemPrompt ? `Global system prompt:\n${globalSystemPrompt}\n\n` : ''}${systemMsg.content}\n\nTool instructions:\n${agentInstructions}`
  } else {
    copy.unshift({
      role: 'system',
      content: `${globalSystemPrompt ? `Global system prompt:\n${globalSystemPrompt}\n\n` : ''}${agentInstructions}`
    })
  }

  return copy
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
    ? (options.skill!.toolDiscovery === 'dynamic' ? 'dynamic' : 'static')
    : 'dynamic'

  const maxSteps = isSkill ? clampMaxSteps(options.skill!.maxSteps) : 8
  const skillTools = isSkill ? (options.skill!.tools || []) : []
  const toolScope = isSkill ? new Set<string>(skillTools) : 'all'

  // Prepare messages history
  let messages: ChatCompletionMessage[] = []
  if (isSkill) {
    messages = buildAgentMessages({
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

  // Initialize active tools for this run
  if (toolDiscovery === 'dynamic') {
    activeToolsByRun.set(reqId, new Set(['search_tools']))
  } else {
    activeToolsByRun.set(reqId, new Set(skillTools))
  }

  const executedCalls = new Set<string>()
  const controller = new AbortController()
  activeAgentRuns.set(reqId, controller)
  const signal = controller.signal

  try {
    cleanupPendingPermissionsForRun(reqId)

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
      const activeTools = activeToolsByRun.get(reqId)

      for (const toolName in ToolRegistry) {
        const tool = ToolRegistry[toolName]
        if (!tool.implemented) continue

        // Whitelist checks depending on toolDiscovery mode
        if (toolDiscovery === 'static') {
          if (!skillTools.includes(toolName)) continue
        } else {
          // Dynamic tool discovery: must be active in current run context
          if (!activeTools || !activeTools.has(toolName)) continue
        }

        const permission = permissions?.[toolName] || 'allow'
        if (permission !== 'deny') {
          toolsToDeclare.push(toChatToolDeclaration(tool))
        }
      }

      const assistantMessage = await callModel(
        mainWindow,
        reqId,
        {
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          model: options.model,
          systemPrompt: options.systemPrompt
        },
        messages,
        toolsToDeclare,
        signal
      )

      messages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          const callId = toolCall.id

          let toolArgs: ToolArgs = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as ToolArgs
          } catch {
            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
          }

          const url = (toolArgs.url as string) || ''

          // Double-layered execution check: registry, implementation, whitelist, permissions
          const toolDef = ToolRegistry[toolName]
          const permission = permissions?.[toolName] || 'allow'

          let isWhitelisted = false
          if (toolDiscovery === 'static') {
            isWhitelisted = skillTools.includes(toolName)
          } else {
            isWhitelisted = !!activeTools && activeTools.has(toolName)
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
            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `Error: ${errorMsg}`
            })
            continue
          }

          // Intercept search_tools execution directly in runner to keep registry stateless
          if (toolName === 'search_tools') {
            const query = (toolArgs.query as string) || ''
            sendEvent(mainWindow, reqId, {
              type: 'tool_call',
              callId,
              toolName,
              args: toolArgs,
              permissionState: 'approved'
            })

            const matchedSummaries = searchToolDefinitions(query, toolScope)

            // Activate matches for this run context
            if (activeTools) {
              matchedSummaries.forEach((t) => activeTools.add(t.name))
            }

            const observation = matchedSummaries.length > 0
              ? JSON.stringify(matchedSummaries, null, 2)
              : `No discoverable tools matched query: "${query}"`

            sendEvent(mainWindow, reqId, {
              type: 'tool_result',
              callId,
              result: {
                title: `Search Tools: "${query}"`,
                summary: `Discovered ${matchedSummaries.length} tools: ${matchedSummaries.map((m) => m.name).join(', ')}`
              }
            })

            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: observation
            })
            continue
          }

          // Deadlock check
          if (toolName === 'fetch_url' && url) {
            const callKey = `${toolName}:${url}`
            if (executedCalls.has(callKey)) {
              const deadlockWarning = `Warning: You have already fetched the URL: ${url}. Fetching it again will not yield new information.`
              sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: deadlockWarning })
              messages.push({
                role: 'tool',
                tool_call_id: callId,
                name: toolName,
                content: deadlockWarning
              })
              continue
            }
            executedCalls.add(callKey)
          }

          // Emit tool_call event
          sendEvent(mainWindow, reqId, {
            type: 'tool_call',
            callId,
            toolName,
            args: toolArgs,
            permissionState: permission === 'ask' ? 'pending' : 'approved'
          })

          let isApproved = true
          if (permission === 'ask') {
            const permissionPromise = new Promise<boolean>((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                const key = `${reqId}:${callId}`
                pendingPermissions.delete(key)
                reject(new Error('Permission request timed out after 10 minutes.'))
              }, 10 * 60 * 1000)

              pendingPermissions.set(`${reqId}:${callId}`, { resolve, reject, timeoutId })
            })

            try {
              isApproved = await permissionPromise
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
              messages.push({
                role: 'tool',
                tool_call_id: callId,
                name: toolName,
                content: `ERROR: ${error.message}`
              })
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

          if (!isApproved) {
            const errorMsg = 'Tool execution denied by user.'
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `ERROR: ${errorMsg}`
            })
            continue
          }

          // Execute tool
          try {
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }
            const { resultForModel, resultForUi } = await toolDef.execute(toolArgs, {
              reqId,
              signal
            })
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }

            sendEvent(mainWindow, reqId, {
              type: 'tool_result',
              callId,
              result: resultForUi
            })

            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: resultForModel
            })
          } catch (error) {
            const err = error as Error
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: err.message })
            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `ERROR: ${err.message}`
            })
          }
        }
        step++
      } else {
        cleanupPendingPermissionsForRun(reqId)
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

    await callModel(
      mainWindow,
      reqId,
      {
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        model: options.model,
        systemPrompt: options.systemPrompt
      },
      messages,
      undefined,
      signal
    )

    cleanupPendingPermissionsForRun(reqId)
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Loop error:', err)
    cleanupPendingPermissionsForRun(reqId)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Loop failed' })
  } finally {
    activeAgentRuns.delete(reqId)
    activeToolsByRun.delete(reqId)
  }
}

export const runAgentSkill = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: AgentSkillRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  return runAgentLoop(mainWindow, reqId, options, permissions)
}

export const runGeneralAgent = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: ChatRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  return runAgentLoop(mainWindow, reqId, options, permissions)
}
