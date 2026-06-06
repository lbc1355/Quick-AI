import { BrowserWindow } from 'electron'
import { AgentSkillRunOptions, ChatCompletionMessage } from '../shared/types'
import { FetchUrlResult, fetchUrl } from './webTools'

const MAX_OBSERVATION_CHARS = 12000

const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 5
  return Math.max(1, Math.min(8, Math.floor(value)))
}

const sendContent = (mainWindow: BrowserWindow, reqId: string, content: string): void => {
  mainWindow.webContents.send('chat-chunk', { reqId, content })
}

const processMessageReasoning = (
  mainWindow: BrowserWindow,
  reqId: string,
  message: ChatCompletionMessage,
  step: number,
  maxSteps: number
): void => {
  // 1. Extract cloud model reasoning_content if present
  if (message.reasoning_content) {
    sendContent(
      mainWindow,
      reqId,
      `[think ${step}/${maxSteps}] ${message.reasoning_content}\n\n`
    )
    message.reasoning_content = ''
  }

  // 2. Extract and send local model <think> reasoning if present, and clean content
  if (message.content && typeof message.content === 'string' && message.content.includes('<think>')) {
    const parts = message.content.split('</think>')
    if (parts.length > 1) {
      const thinking = parts[0].replace('<think>', '').trim()
      sendContent(
        mainWindow,
        reqId,
        `[think ${step}/${maxSteps}] ${thinking}\n\n`
      )
      // Strip the thinking process from the message content
      message.content = parts.slice(1).join('').trim()
    } else {
      // In-progress thinking without closing tag
      const thinking = message.content.replace('<think>', '').trim()
      sendContent(
        mainWindow,
        reqId,
        `[think ${step}/${maxSteps}] ${thinking}\n\n`
      )
      message.content = ''
    }
  }
}

const callModel = async (
  options: AgentSkillRunOptions,
  messages: ChatCompletionMessage[]
): Promise<ChatCompletionMessage> => {
  const completionsUrl = `${options.apiUrl.replace(/\/$/, '')}/chat/completions`

  const tools = [
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The absolute public URL to fetch.'
            }
          },
          required: ['url']
        }
      }
    }
  ]

  const response = await fetch(completionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: false
    })
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

const formatLinks = (result: FetchUrlResult): string => {
  return result.links
    .slice(0, 25)
    .map((link, index) => `${index + 1}. ${link.text} - ${link.href}`)
    .join('\n')
}

const formatObservation = (result: FetchUrlResult): string => {
  const links = formatLinks(result)
  const body = [
    `URL: ${result.finalUrl}`,
    result.title ? `Title: ${result.title}` : '',
    result.truncated ? 'Note: page text was truncated.' : '',
    links ? `Links:\n${links}` : '',
    `Text:\n${result.text}`
  ].filter(Boolean).join('\n\n')

  return body.slice(0, MAX_OBSERVATION_CHARS)
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
  options: AgentSkillRunOptions
): Promise<void> => {
  const maxSteps = clampMaxSteps(options.skill.maxSteps)
  const messages = buildAgentMessages(options)
  const executedCalls = new Set<string>()

  try {
    sendContent(mainWindow, reqId, `Running agent skill: ${options.skill.name}\n\n`)

    for (let step = 1; step <= maxSteps;) {
      const assistantMessage = await callModel(options, messages)
      
      // Push assistant's message into messages history
      messages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Stream thinking process for intermediate steps as logs
        processMessageReasoning(mainWindow, reqId, assistantMessage, step, maxSteps)
        
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          
          let toolArgs: { url?: string } = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as { url?: string }
          } catch (e) {
            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments)
          }

          const url = toolArgs.url || ''

          // Deadlock check
          const callKey = `${toolName}:${url}`
          if (executedCalls.has(callKey)) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: `Warning: You have already fetched the URL: ${url}. Fetching it again will not yield new information. Please analyze the existing observations or try a different URL.`
            })
            continue
          }
          executedCalls.add(callKey)

          sendContent(
            mainWindow,
            reqId,
            `[tool ${step}/${maxSteps}] ${toolName}\n${url}\n\n`
          )

          try {
            const result = await fetchUrl(url)
            const observation = formatObservation(result)
            sendContent(
              mainWindow,
              reqId,
              `[result ${step}/${maxSteps}] ${result.title || result.finalUrl}\n${result.finalUrl}\n\n`
            )
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: observation
            })
          } catch (error) {
            const err = error as Error
            sendContent(mainWindow, reqId, `[error ${step}/${maxSteps}] ${err.message}\n\n`)
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: `ERROR: ${err.message}`
            })
          }
        }

        step++
      } else {
        // No tool calls: this is the final answer!
        // Move its reasoning back to standard reasoningContent to show in main bubble
        if (assistantMessage.reasoning_content) {
          mainWindow.webContents.send('chat-chunk', {
            reqId,
            reasoningContent: assistantMessage.reasoning_content + '\n\n'
          })
          assistantMessage.reasoning_content = ''
        }
        if (assistantMessage.content && typeof assistantMessage.content === 'string' && assistantMessage.content.includes('<think>')) {
          const parts = assistantMessage.content.split('</think>')
          if (parts.length > 1) {
            const thinking = parts[0].replace('<think>', '').trim()
            mainWindow.webContents.send('chat-chunk', {
              reqId,
              reasoningContent: thinking + '\n\n'
            })
            assistantMessage.content = parts.slice(1).join('').trim()
          }
        }
        const finalContent = assistantMessage.content || ''
        sendContent(mainWindow, reqId, `\n[final]\n${finalContent}`)
        mainWindow.webContents.send('chat-chunk', { reqId, done: true })
        return
      }
    }

    // Maximum steps reached without final answer: request final summary
    messages.push({
      role: 'user',
      content: 'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
    })
    const finalMessage = await callModel(options, messages)
    if (finalMessage.reasoning_content) {
      mainWindow.webContents.send('chat-chunk', {
        reqId,
        reasoningContent: finalMessage.reasoning_content + '\n\n'
      })
      finalMessage.reasoning_content = ''
    }
    if (finalMessage.content && typeof finalMessage.content === 'string' && finalMessage.content.includes('<think>')) {
      const parts = finalMessage.content.split('</think>')
      if (parts.length > 1) {
        const thinking = parts[0].replace('<think>', '').trim()
        mainWindow.webContents.send('chat-chunk', {
          reqId,
          reasoningContent: thinking + '\n\n'
        })
        finalMessage.content = parts.slice(1).join('').trim()
      }
    }
    const finalContent = finalMessage.content || ''
    sendContent(mainWindow, reqId, `\n[final]\n${finalContent}`)
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Skill Runner error:', err)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Skill failed' })
  }
}
