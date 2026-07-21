import { describe, expect, it } from 'vitest'
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
})
