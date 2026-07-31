import { describe, expect, it } from 'vitest'
import type { ChatCompletionMessage } from '../../shared/types'
import { getAdapter } from './modelAdapter'

describe('model compatibility adapters', () => {
  it('applies the GLM compatibility profile without mutating input', () => {
    const adapter = getAdapter('glm', 'openai-compatible', 'glm-4.7')
    const messages = [
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'private reasoning',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'file_read', arguments: '{}' }
          }
        ]
      },
      {
        role: 'tool',
        name: 'file_read',
        tool_call_id: 'call-1',
        content: 'result'
      }
    ]

    const sanitized = adapter.sanitizeMessages(messages)
    const body = adapter.sanitizeBody({ model: 'glm-4.7', tool_choice: 'auto' })

    expect(sanitized[0]).not.toHaveProperty('reasoning_content')
    expect(sanitized[0]).not.toHaveProperty('content')
    expect(sanitized[1]).not.toHaveProperty('name')
    expect(body).not.toHaveProperty('tool_choice')
    expect(messages[0]).toHaveProperty('reasoning_content', 'private reasoning')
    expect(messages[1]).toHaveProperty('name', 'file_read')
  })

  it('resolves model rules and explicit overrides as data', () => {
    const step = getAdapter('step', 'openai-compatible', 'step-3.7-flash')
    expect(step.sanitizeBody({ model: 'step-3.7-flash' })).toMatchObject({
      reasoning_format: 'deepseek-style'
    })

    const glmOverride = getAdapter('glm', 'openai-compatible', 'glm-custom', {
      omitToolChoice: false
    })
    expect(glmOverride.sanitizeBody({ tool_choice: 'auto' })).toEqual({ tool_choice: 'auto' })
  })

  it('preserves tool-call reasoning for DeepSeek routed through OpenCode only', () => {
    const history: ChatCompletionMessage[] = [
      {
        role: 'assistant',
        content: 'Previous completed answer',
        reasoning_content: 'old completed-turn reasoning'
      },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'reasoning required to resume this tool turn',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'file_read', arguments: '{}' }
          }
        ]
      }
    ]

    const deepseek = getAdapter('opencode', 'openai-compatible', 'deepseek-v4-pro')
    const sanitized = deepseek.sanitizeMessages(history)

    expect(sanitized[0]).not.toHaveProperty('reasoning_content')
    expect(sanitized[1]).toHaveProperty(
      'reasoning_content',
      'reasoning required to resume this tool turn'
    )
    expect(history[0]).toHaveProperty('reasoning_content', 'old completed-turn reasoning')

    const qwen = getAdapter('opencode', 'openai-compatible', 'qwen3-coder-plus')
    expect(qwen.sanitizeMessages(history)[1]).not.toHaveProperty('reasoning_content')
  })

  it('applies the same tool-call replay policy to the official DeepSeek provider', () => {
    const adapter = getAdapter('deepseek', 'openai-compatible', 'deepseek-reasoner')
    const [message] = adapter.sanitizeMessages([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'thinking',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'file_read', arguments: '{}' }
          }
        ]
      }
    ])

    expect(message.reasoning_content).toBe('thinking')
  })
})
