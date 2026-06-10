import { join } from 'path'
import { existsSync, appendFileSync, mkdirSync } from 'fs'
import { getLogsRoot } from '../paths'
import { ChatCompletionMessage } from '../../shared/types'

export interface SessionLoggerStartOptions {
  model: string
  apiUrl: string
  skillName?: string
  messages: ChatCompletionMessage[]
}

export class SessionLogger {
  private static getSessionLogPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(getLogsRoot(), `session-${safeId}.md`)
  }

  private static append(sessionId: string, markdown: string): void {
    try {
      const path = this.getSessionLogPath(sessionId)
      const dir = join(path, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const isNew = !existsSync(path)
      let content = ''
      if (isNew) {
        content += `# Session Debug Log: ${sessionId}\n\n`
      }
      content += markdown + '\n'
      appendFileSync(path, content, 'utf8')
    } catch (err) {
      console.warn(`Failed to write session log for ${sessionId}:`, (err as Error).message)
    }
  }

  private static formatTime(date: Date): string {
    const Y = date.getFullYear()
    const M = String(date.getMonth() + 1).padStart(2, '0')
    const D = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    const ms = String(date.getMilliseconds()).padStart(3, '0')
    return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`
  }

  static logRunStart(sessionId: string, runId: string, options: SessionLoggerStartOptions): void {
    const time = this.formatTime(new Date())
    const messagesStr = options.messages.map((m, idx) => {
      let contentStr = ''
      if (typeof m.content === 'string') {
        contentStr = m.content
      } else if (Array.isArray(m.content)) {
        contentStr = JSON.stringify(m.content, null, 2)
      }

      let toolCallsStr = ''
      if (m.tool_calls && m.tool_calls.length > 0) {
        toolCallsStr = '\n**Tool Calls**:\n' + m.tool_calls.map(tc => {
          return `- ID: \`${tc.id}\`, Name: \`${tc.function.name}\`, Args: \`${tc.function.arguments}\``
        }).join('\n')
      }

      let reasoningStr = ''
      if (m.reasoning_content) {
        reasoningStr = `\n**Reasoning thought**:\n> ${m.reasoning_content.replace(/\n/g, '\n> ')}`
      }

      const roleHeader = m.role === 'tool' && m.tool_call_id
        ? `##### [Message ${idx + 1}] Role: \`tool\` (call ID: \`${m.tool_call_id}\`, name: \`${m.name || ''}\`)`
        : `##### [Message ${idx + 1}] Role: \`${m.role}\``

      return `${roleHeader}\n${reasoningStr ? reasoningStr + '\n' : ''}\`\`\`\n${contentStr}\n\`\`\`${toolCallsStr}`
    }).join('\n\n')

    const md = `
## [${time}] Run Started: \`${runId}\`
- **Model**: \`${options.model}\`
- **API URL**: \`${options.apiUrl}\`
- **Mode**: \`${options.skillName || 'General Agent'}\`

### Initial Context (Messages before run)

${messagesStr}

---
`
    this.append(sessionId, md)
  }

  static logStepStart(sessionId: string, step: number, maxSteps: number): void {
    const time = this.formatTime(new Date())
    const md = `
### Step ${step} / ${maxSteps} (Timestamp: ${time})
`
    this.append(sessionId, md)
  }

  static logModelResponse(sessionId: string, response: ChatCompletionMessage): void {
    const time = this.formatTime(new Date())
    let toolCallsStr = '(none)'
    if (response.tool_calls && response.tool_calls.length > 0) {
      toolCallsStr = '\n' + response.tool_calls.map(tc => {
        return `- ID: \`${tc.id}\`, Name: \`${tc.function.name}\`\n  - Arguments:\n  \`\`\`json\n  ${tc.function.arguments}\n  \`\`\``
      }).join('\n')
    }

    const md = `
#### Model Response (Timestamp: ${time})
- **Reasoning**:
> ${response.reasoning_content ? response.reasoning_content.trim().replace(/\n/g, '\n> ') : '(none)'}

- **Content**:
\`\`\`
${response.content || '(none)'}
\`\`\`

- **Tool Calls**: ${toolCallsStr}
`
    this.append(sessionId, md)
  }

  static logToolExecution(
    sessionId: string,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    permission: string,
    status: string,
    durationMs: number,
    result: string
  ): void {
    const time = this.formatTime(new Date())
    const md = `
#### Tool Execution (Timestamp: ${time})
- **Tool**: \`${toolName}\`
- **Call ID**: \`${callId}\`
- **Arguments**:
\`\`\`json
${JSON.stringify(args, null, 2)}
\`\`\`
- **Permission Decision**: \`${permission}\`
- **Status**: \`${status}\`
- **Duration**: \`${durationMs}ms\`
- **Output Size**: \`${result.length}\` characters
- **Output**:
\`\`\`
${result}
\`\`\`
`
    this.append(sessionId, md)
  }

  static logRunEnd(sessionId: string, status: string, error?: string): void {
    const time = this.formatTime(new Date())
    const md = `
### Run Finished: \`${status}\` (Timestamp: ${time})
${error ? `- **Error**: \`${error}\`` : ''}

================================================================================
`
    this.append(sessionId, md)
  }
}
