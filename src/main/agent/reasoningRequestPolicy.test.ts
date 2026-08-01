import { describe, expect, it } from 'vitest'
import { applyReasoningRequest } from './reasoningRequestPolicy'
import type { ModelReasoningControl } from '../../shared/types'

describe('applyReasoningRequest', () => {
  const effort: ModelReasoningControl = {
    mode: 'effort',
    encoding: 'openai-effort',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    levelMap: { minimal: 'low', xhigh: 'high', max: 'high' }
  }

  it('leaves auto and fixed untouched and does not mutate input', () => {
    const original = { model: 'm', reasoning: { summary: 'keep-me' } }
    const snapshot = JSON.stringify(original)
    const auto = applyReasoningRequest({
      body: original,
      transportId: 'openai-chat-completions',
      control: effort,
      requested: 'auto'
    })
    expect(auto.applied).toBe(false)
    expect(auto.body).toEqual(original)
    expect(JSON.stringify(original)).toBe(snapshot)

    const fixed = applyReasoningRequest({
      body: original,
      transportId: 'openai-chat-completions',
      control: { mode: 'fixed' },
      requested: 'high'
    })
    expect(fixed.applied).toBe(false)
    expect(fixed.body).toEqual(original)
    expect(fixed.body).not.toBe(original)
  })

  it('encodes OpenAI chat completions effort', () => {
    const result = applyReasoningRequest({
      body: { model: 'gpt' },
      transportId: 'openai-chat-completions',
      control: effort,
      requested: 'high'
    })
    expect(result.body).toEqual({ model: 'gpt', reasoning_effort: 'high' })
    expect(result.applied).toBe(true)
  })

  it('encodes OpenAI responses effort and preserves summary', () => {
    const withSummary = applyReasoningRequest({
      body: { model: 'gpt', reasoning: { summary: 'concise' } },
      transportId: 'openai-responses',
      control: effort,
      requested: 'minimal'
    })
    expect(withSummary.body).toEqual({
      model: 'gpt',
      reasoning: { summary: 'concise', effort: 'low' }
    })

    const withoutSummary = applyReasoningRequest({
      body: { model: 'gpt' },
      transportId: 'openai-responses',
      control: effort,
      requested: 'high'
    })
    expect(withoutSummary.body).toEqual({
      model: 'gpt',
      reasoning: { effort: 'high', summary: 'auto' }
    })
  })

  it('encodes OpenRouter effort and budget', () => {
    const openrouterEffort = applyReasoningRequest({
      body: { model: 'x' },
      transportId: 'openai-chat-completions',
      control: {
        mode: 'effort',
        encoding: 'openrouter-reasoning',
        levels: ['low', 'high']
      },
      requested: 'high'
    })
    expect(openrouterEffort.body).toEqual({ model: 'x', reasoning: { effort: 'high' } })

    const budget = applyReasoningRequest({
      body: { model: 'x' },
      transportId: 'openai-chat-completions',
      control: {
        mode: 'budget',
        encoding: 'openrouter-budget',
        levels: ['low', 'high'],
        budgets: { low: 1024, high: 20000 },
        minBudget: 1024,
        maxBudget: 8192
      },
      requested: 'high',
      outputTokenLimit: 4096
    })
    expect(budget.body).toEqual({ model: 'x', reasoning: { max_tokens: 3072 } })
  })

  it('encodes Qwen and DeepSeek toggles', () => {
    expect(
      applyReasoningRequest({
        body: { model: 'qwen' },
        transportId: 'openai-chat-completions',
        control: {
          mode: 'toggle',
          encoding: 'qwen-enable-thinking',
          supportsOff: true
        },
        requested: 'on'
      }).body
    ).toEqual({ model: 'qwen', enable_thinking: true })

    expect(
      applyReasoningRequest({
        body: { model: 'qwen' },
        transportId: 'openai-chat-completions',
        control: {
          mode: 'toggle',
          encoding: 'qwen-enable-thinking',
          supportsOff: true
        },
        requested: 'off'
      }).body
    ).toEqual({ model: 'qwen', enable_thinking: false })

    expect(
      applyReasoningRequest({
        body: { model: 'ds' },
        transportId: 'openai-chat-completions',
        control: {
          mode: 'toggle',
          encoding: 'deepseek-thinking-toggle',
          supportsOff: true
        },
        requested: 'on'
      }).body
    ).toEqual({ model: 'ds', thinking: { type: 'enabled' } })

    expect(
      applyReasoningRequest({
        body: { model: 'ds' },
        transportId: 'openai-chat-completions',
        control: {
          mode: 'toggle',
          encoding: 'deepseek-thinking-toggle',
          supportsOff: true
        },
        requested: 'off'
      }).body
    ).toEqual({ model: 'ds', thinking: { type: 'disabled' } })
  })
})
