import { describe, expect, it } from 'vitest'

import { PreparedToolCall } from './toolCallPlanning'
import { buildAgentStepPresentation } from './toolStepPresentation'

const call = (
  toolName: string,
  purpose?: string,
  index = 0
): PreparedToolCall => ({
  index,
  toolCall: {
    id: `call-${index}`,
    type: 'function',
    function: {
      name: toolName,
      arguments: '{}'
    }
  },
  toolName,
  callId: `call-${index}`,
  args: {},
  purpose,
  permission: 'allow',
  isValid: true,
  isDeadlock: false,
  classification: 'direct'
})

describe('buildAgentStepPresentation', () => {
  it('uses visible assistant text for the step message and a compact title', () => {
    const result = buildAgentStepPresentation(
      '我先读取 README。\n然后分析入口。',
      [call('file_read', '读取 README')]
    )

    expect(result).toEqual({
      title: '我先读取 README',
      message: '我先读取 README。 然后分析入口。'
    })
  })

  it('falls back to one tool purpose when the assistant text is empty', () => {
    const result = buildAgentStepPresentation('', [call('file_read', '读取 README')])

    expect(result).toEqual({
      title: '读取 README',
      message: '读取 README'
    })
  })

  it('summarizes multiple tool purposes without exposing raw tool-call wording', () => {
    const result = buildAgentStepPresentation('', [
      call('file_read', '读取 README', 0),
      call('file_read', '读取 package.json', 1),
      call('shell', '运行测试', 2)
    ])

    expect(result).toEqual({
      title: '准备执行 3 个工具：读取 README；读取 package',
      message: '准备执行 3 个工具：读取 README；读取 package.json…'
    })
  })

  it('uses unique tool names when no visible text or purpose exists', () => {
    const result = buildAgentStepPresentation('', [
      call('file_read', undefined, 0),
      call('file_read', undefined, 1),
      call('shell', undefined, 2),
      call('web_search', undefined, 3),
      call('fetch_url', undefined, 4)
    ])

    expect(result).toEqual({
      title: '准备调用 5 个工具：fileread、shell、websearch 等 4 类…',
      message: '准备调用 5 个工具：file_read、shell、web_search 等 4 类工具。'
    })
  })
})
