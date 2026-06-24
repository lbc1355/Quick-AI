import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { createRunUsageTracker } from './runUsageTracker'
import { runForcedFinalTurn } from './forcedFinalTurnRunner'

describe('runForcedFinalTurn', () => {
  it('adds a max-steps prompt, trims messages, runs the final model turn, and streams final output', async () => {
    const messages: ChatCompletionMessage[] = [{ role: 'user', content: 'Original request' }]
    const trimmedMessages: ChatCompletionMessage[] = [
      ...messages,
      { role: 'user', content: 'trimmed continuation' }
    ]
    const usageTracker = createRunUsageTracker()
    const trimMessagesToFit = vi.fn(() => trimmedMessages)
    const runModelTurn = vi.fn(async (_options) => {
      _options.onContentChunk('Final ')
      _options.onContentChunk('answer.')
      return {
        assistantMessage: { role: 'assistant', content: 'Final answer.' },
        streamedText: 'Final answer.'
      }
    })
    const emitFinal = vi.fn()
    const emitReasoning = vi.fn()

    const result = await runForcedFinalTurn({
      messages,
      haltRequested: false,
      signal: new AbortController().signal,
      modelConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      contextSize: 8000,
      usageTracker,
      emitReasoning,
      emitFinal,
      dependencies: {
        trimMessagesToFit,
        runModelTurn
      }
    })

    expect(trimMessagesToFit).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Original request' },
        {
          role: 'user',
          content:
            'The maximum number of tool steps has been reached. Please provide a final answer based only on the observations available.'
        }
      ],
      {
        maxTokens: 8000,
        reserveForResponseRatio: 0.04,
        strategy: 'truncate-oldest-tool'
      }
    )
    expect(runModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: trimmedMessages,
        usageTracker,
        onReasoning: emitReasoning
      })
    )
    expect(emitFinal).toHaveBeenNthCalledWith(1, 'Final ')
    expect(emitFinal).toHaveBeenNthCalledWith(2, 'answer.')
    expect(result.messages).toBe(trimmedMessages)
    expect(result.finalMessage).toEqual({ role: 'assistant', content: 'Final answer.' })
  })

  it('emits assistant content when the final turn did not stream text', async () => {
    const emitFinal = vi.fn()

    await runForcedFinalTurn({
      messages: [],
      haltRequested: true,
      signal: new AbortController().signal,
      modelConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      contextSize: 8000,
      usageTracker: createRunUsageTracker(),
      emitReasoning: vi.fn(),
      emitFinal,
      dependencies: {
        trimMessagesToFit: vi.fn((messages) => messages),
        runModelTurn: vi.fn(async () => ({
          assistantMessage: { role: 'assistant', content: 'Fallback final.' },
          streamedText: ''
        }))
      }
    })

    expect(emitFinal).toHaveBeenCalledWith('Fallback final.')
  })
})
