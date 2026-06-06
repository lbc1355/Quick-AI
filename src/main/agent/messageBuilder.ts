import { ChatCompletionMessage, AgentSkillRunOptions } from '../../shared/types'

export function buildSkillMessages(options: AgentSkillRunOptions): ChatCompletionMessage[] {
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

export function prepareChatAgentMessages(
  messages: ChatCompletionMessage[],
  globalSystemPrompt?: string
): ChatCompletionMessage[] {
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
