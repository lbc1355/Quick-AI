import { describe, expect, it, vi } from 'vitest'
import { ChatCompletionMessage, Message } from '../../shared/types'
import { buildCompactionTranscript, compactContextWithModel } from './contextCompactor'
import { toWellFormedText } from '../../shared/unicodeText'

const msg = (id: string, role: Message['role'], content: string): Message => ({
  id,
  role,
  content
})

describe('contextCompactor', () => {
  it('summarizes older messages with the model and reports the preserved tail', async () => {
    const callModel = vi.fn(async () => ({
      role: 'assistant',
      content: '## 上下文摘要\n保留关键决策。'
    }))
    const messages = Array.from({ length: 10 }, (_, index) =>
      msg(String(index), index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
    )

    const result = await compactContextWithModel(
      {
        sessionId: 'session-test',
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'model-a',
        messages,
        keepRecentMessages: 4,
        systemPrompt: 'my-custom-system-prompt'
      },
      { callModel, now: () => 1000 }
    )

    expect(result).toMatchObject({
      summary: '## 上下文摘要\n保留关键决策。',
      compactedCount: 6,
      keptCount: 4
    })
    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-a', reasoningPreference: 'auto' }),
      expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'my-custom-system-prompt' }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('【系统指令：请根据以上对话历史，进行上下文压缩和摘要】')
        })
      ]),
      undefined,
      undefined,
      expect.any(Object)
    )
  })

  it('includes compact tool and attachment hints in the transcript', () => {
    const transcript = buildCompactionTranscript([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Final answer',
        files: [{ name: 'notes.txt', type: 'text', content: 'important note' }],
        agentEvents: [{ type: 'tool_done', toolName: 'file_read' } as never]
      }
    ])

    expect(transcript).toContain('attachment: notes.txt')
    expect(transcript).toContain('important note')
    expect(transcript).toContain('agent_events: 1')
    expect(transcript).toContain('file_read')
  })

  it('feeds bounded attachment and tool hints to the summarizer without private reasoning', async () => {
    const callModel = vi.fn(async (_options: unknown, _messages: ChatCompletionMessage[]) => ({
      role: 'assistant' as const,
      content: 'summary'
    }))
    const history: Message[] = [
      msg('u1', 'user', `${'x'.repeat(11919)}🌟${'y'.repeat(100)}`),
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        reasoning_content: 'private chain of thought',
        files: [
          { name: 'notes.txt', type: 'text', content: `${'x'.repeat(1519)}🌟${'y'.repeat(100)}` }
        ],
        agentEvents: [{ type: 'tool_done', toolName: 'file_read' } as never]
      },
      ...Array.from({ length: 6 }, (_, index) =>
        msg(`tail-${index}`, index % 2 === 0 ? 'user' : 'assistant', `tail ${index}`)
      )
    ]

    await compactContextWithModel(
      {
        sessionId: 'session-hints',
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'model-a',
        messages: history,
        keepRecentMessages: 6
      },
      { callModel }
    )

    const sentMessages = callModel.mock.calls[0][1]
    const assistant = sentMessages.find((message) => message.role === 'assistant')
    expect(assistant?.content).toContain('attachment: notes.txt')
    expect(assistant?.content).toContain('file_read')
    expect(assistant?.content).toContain('[... truncated')
    expect(assistant?.content).not.toContain('private chain of thought')
    for (const message of sentMessages) {
      expect(message.content).toBe(toWellFormedText(String(message.content)))
    }
  })

  it('rejects sessions with too little old context to compact', async () => {
    await expect(
      compactContextWithModel({
        sessionId: 'session-test',
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'model-a',
        messages: [msg('1', 'user', 'hi'), msg('2', 'assistant', 'hello')],
        keepRecentMessages: 6
      })
    ).rejects.toThrow('当前对话可压缩内容不足')
  })
})
