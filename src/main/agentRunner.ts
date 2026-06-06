import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatCompletionMessage, AgentEvent } from '../shared/types'
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

const processMessageReasoning = (
  mainWindow: BrowserWindow,
  reqId: string,
  message: ChatCompletionMessage
): void => {
  // 1. Extract cloud model reasoning_content if present
  if (message.reasoning_content) {
    sendEvent(mainWindow, reqId, { type: 'reasoning', content: message.reasoning_content })
    message.reasoning_content = ''
  }

  // 2. Extract and send local model <think> reasoning if present, and clean content
  if (message.content && typeof message.content === 'string' && message.content.includes('<think>')) {
    const parts = message.content.split('</think>')
    if (parts.length > 1) {
      const thinking = parts[0].replace('<think>', '').trim()
      sendEvent(mainWindow, reqId, { type: 'reasoning', content: thinking })
      // Strip the thinking process from the message content
      message.content = parts.slice(1).join('').trim()
    } else {
      // In-progress thinking without closing tag
      const thinking = message.content.replace('<think>', '').trim()
      sendEvent(mainWindow, reqId, { type: 'reasoning', content: thinking })
      message.content = ''
    }
  }
}

const callModel = async (
  options: AgentSkillRunOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: any[]
): Promise<ChatCompletionMessage> => {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  const body: any = {
    model: options.model,
    messages,
    stream: false
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
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`)
  }

  const data = (await response.json()) as { choices?: Array<{ message?: ChatCompletionMessage }> }
  const message = data.choices?.[0]?.message
  if (!message) {
    throw new Error('API returned an empty response choice')
  }
  return message
}

const buildAgentMessages = (options: AgentSkillRunOptions): ChatCompletionMessage[] => {
  const skillMarkdown = options.skill.rawMarkdown || options.skill.prompt
  const baseSystemPrompt = options.systemPrompt ? `User global system prompt:\n${options.systemPrompt}\n\n` : ''

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

  // Build tool declarations list by filtering based on implemented and permissions
  const toolsToDeclare: any[] = []
  for (const toolName in ToolRegistry) {
    const tool = ToolRegistry[toolName]
    if (tool.implemented) {
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
      const assistantMessage = await callModel(options, messages, toolsToDeclare)

      // Push assistant's message into messages history
      messages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Stream thinking process for intermediate steps as logs
        processMessageReasoning(mainWindow, reqId, assistantMessage)

        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          const callId = toolCall.id

          let toolArgs: any = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments)
          } catch (e) {
            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
          }

          const url = toolArgs.url || ''

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
            const { resultForModel, resultForUi } = await toolDef.execute(toolArgs)

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
        processMessageReasoning(mainWindow, reqId, assistantMessage)

        const finalContent = typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : ''
        sendEvent(mainWindow, reqId, { type: 'final', content: finalContent })

        cleanupPendingPermissionsForRun(reqId)

        mainWindow.webContents.send('chat-chunk', { reqId, done: true })
        return
      }
    }

    // Maximum steps reached without final answer: request final summary
    messages.push({
      role: 'user',
      content: 'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
    })

    // Call model without tools to force final direct answer text
    const finalMessage = await callModel(options, messages)
    processMessageReasoning(mainWindow, reqId, finalMessage)

    const finalContent = typeof finalMessage.content === 'string'
      ? finalMessage.content
      : ''
    sendEvent(mainWindow, reqId, { type: 'final', content: finalContent })

    cleanupPendingPermissionsForRun(reqId)

    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Skill Runner error:', err)
    cleanupPendingPermissionsForRun(reqId)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Skill failed' })
  }
}
