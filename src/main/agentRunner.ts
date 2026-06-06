import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatCompletionMessage, AgentEvent, ToolArgs, ChatToolDeclaration } from '../shared/types'
import { ToolRegistry } from './toolRegistry'

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
  options: AgentSkillRunOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal
): Promise<ChatCompletionMessage> => {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
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
                sendEvent(mainWindow, reqId, { type: 'final', content: parts[0] })
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
                  sendEvent(mainWindow, reqId, { type: 'final', content: parts[1] })
                }
              } else {
                assistantMessage.reasoning_content += contentChunk
                sendEvent(mainWindow, reqId, { type: 'reasoning', content: contentChunk })
              }
            } else {
              if (typeof assistantMessage.content !== 'string') assistantMessage.content = ''
              assistantMessage.content += contentChunk
              sendEvent(mainWindow, reqId, { type: 'final', content: contentChunk })
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

export const runAgentSkill = async (
  mainWindow: BrowserWindow,
  reqId: string,
  options: AgentSkillRunOptions,
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): Promise<void> => {
  const maxSteps = clampMaxSteps(options.skill.maxSteps)
  const messages = buildAgentMessages(options)
  const executedCalls = new Set<string>()
  const controller = new AbortController()
  activeAgentRuns.set(reqId, controller)
  const signal = controller.signal

  // Build tool declarations list by filtering based on implemented, skill whitelist, and permissions
  const skillTools = options.skill.tools || []
  const toolsToDeclare: ChatToolDeclaration[] = []
  for (const toolName in ToolRegistry) {
    const tool = ToolRegistry[toolName]
    if (tool.implemented && skillTools.includes(toolName)) {
      const permission = permissions?.[toolName] || 'allow'
      if (permission !== 'deny') {
        toolsToDeclare.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        })
      }
    }
  }

  try {
    // Clean up any stale permissions first
    cleanupPendingPermissionsForRun(reqId)

    sendEvent(mainWindow, reqId, { type: 'agent_start', skillName: options.skill.name })

    for (let step = 1; step <= maxSteps; ) {
      if (signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      const assistantMessage = await callModel(
        mainWindow,
        reqId,
        options,
        messages,
        toolsToDeclare,
        signal
      )

      // Push assistant's message into messages history
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

          // Double-layered check: tool registry, implementation, and permission check
          const toolDef = ToolRegistry[toolName]
          const permission = permissions?.[toolName] || 'allow'

          if (!toolDef || !toolDef.implemented || permission === 'deny') {
            const errorMsg = `Tool execution blocked: Tool "${toolName}" is not registered, not implemented, or denied by policy.`
            sendEvent(mainWindow, reqId, { type: 'tool_error', callId, error: errorMsg })
            messages.push({
              role: 'tool',
              tool_call_id: callId,
              name: toolName,
              content: `Error: ${errorMsg}`
            })
            continue
          }

          // Deadlock check (only for fetch_url URLs)
          if (toolName === 'fetch_url' && url) {
            const callKey = `${toolName}:${url}`
            if (executedCalls.has(callKey)) {
              const deadlockWarning = `Warning: You have already fetched the URL: ${url}. Fetching it again will not yield new information. Please analyze the existing observations or try a different URL.`
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

          // Emit tool_call event (starts in 'pending' if it requires ask permission)
          sendEvent(mainWindow, reqId, {
            type: 'tool_call',
            callId,
            toolName,
            args: toolArgs,
            permissionState: permission === 'ask' ? 'pending' : 'approved'
          })

          // Pause and ask for user permission if required
          let isApproved = true
          if (permission === 'ask') {
            const permissionPromise = new Promise<boolean>((resolve, reject) => {
              const timeoutId = setTimeout(
                () => {
                  const key = `${reqId}:${callId}`
                  pendingPermissions.delete(key)
                  reject(new Error('Permission request timed out after 10 minutes.'))
                },
                10 * 60 * 1000
              )

              pendingPermissions.set(`${reqId}:${callId}`, { resolve, reject, timeoutId })
            })

            try {
              isApproved = await permissionPromise
            } catch (err) {
              const error = err as Error
              // Emit denied tool_call state to transition from pending
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

          // Transition state to approved/denied
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

          // Tool approved or allowed, execute it
          try {
            if (signal.aborted) {
              throw new Error('Agent execution aborted by user.')
            }
            const { resultForModel, resultForUi } = await toolDef.execute(toolArgs)
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
        // No tool calls: this is the final answer!
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

    // Call model without tools to force final direct answer text
    await callModel(mainWindow, reqId, options, messages, undefined, signal)

    cleanupPendingPermissionsForRun(reqId)
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Skill Runner error:', err)
    cleanupPendingPermissionsForRun(reqId)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Skill failed' })
  } finally {
    activeAgentRuns.delete(reqId)
  }
}
