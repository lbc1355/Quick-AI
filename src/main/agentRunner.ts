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
        const finalContent = assistantMessage.content || ''
        sendContent(mainWindow, reqId, `\n${finalContent}`)
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
    const finalContent = finalMessage.content || ''
    sendContent(mainWindow, reqId, `\n${finalContent}`)
    mainWindow.webContents.send('chat-chunk', { reqId, done: true })
  } catch (error) {
    const err = error as Error
    console.error('Agent Skill Runner error:', err)
    mainWindow.webContents.send('chat-chunk', { reqId, error: err.message || 'Agent Skill failed' })
  }
}
