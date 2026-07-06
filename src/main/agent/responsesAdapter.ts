import { ChatCompletionMessage, ChatToolDeclaration } from '../../shared/types'

export interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output'
  role?: 'user' | 'assistant'
  content?: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string }
    | { type: 'output_text'; text: string }
  >
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

export function chatMessagesToResponsesInput(messages: ChatCompletionMessage[]): {
  instructions: string
  input: ResponsesInputItem[]
} {
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const instructions = systemMsgs.map((m) => m.content).join('\n\n')

  const input: ResponsesInputItem[] = []

  messages.forEach((msg) => {
    if (msg.role === 'system') return

    if (msg.role === 'user') {
      const content: Array<
        | { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string }
      > = []
      if (typeof msg.content === 'string') {
        content.push({ type: 'input_text', text: msg.content })
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach((part) => {
          if (part.type === 'text') {
            content.push({ type: 'input_text', text: part.text || '' })
          } else if (part.type === 'image_url') {
            content.push({
              type: 'input_image',
              image_url: part.image_url?.url || ''
            })
          }
        })
      }
      input.push({
        type: 'message',
        role: 'user',
        content
      })
    } else if (msg.role === 'assistant') {
      // 1. Add assistant message text content if present
      const content: Array<{ type: 'output_text'; text: string }> = []
      if (typeof msg.content === 'string' && msg.content.trim()) {
        content.push({ type: 'output_text', text: msg.content })
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach((part) => {
          if (part.type === 'text') {
            content.push({ type: 'output_text', text: part.text || '' })
          }
        })
      }

      if (content.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content
        })
      }

      // 2. Add assistant function calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        msg.tool_calls.forEach((tc) => {
          input.push({
            type: 'function_call',
            call_id: tc.id || `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: tc.function.name,
            arguments: tc.function.arguments
          })
        })
      }
    } else if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: typeof msg.content === 'string' ? msg.content : ''
      })
    }
  })

  return { instructions, input }
}

export function chatToolsToResponsesTools(tools?: ChatToolDeclaration[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined
  // Responses API tools parameter is flat: { type: 'function', name, description, parameters }
  return tools.map((tool) => {
    if (tool.type === 'function') {
      return {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }
    return tool
  })
}
