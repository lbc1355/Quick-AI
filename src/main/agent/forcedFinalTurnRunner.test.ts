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
    const lifecycleOrder: string[] = []
    const onRequestPrepared = vi.fn(() => {
      lifecycleOrder.push('prepared')
      return 'request-1'
    })
    const onRequestSettled = vi.fn(() => {
      lifecycleOrder.push('settled')
    })

    const result = await runForcedFinalTurn({
      messages,
      reason: 'step_limit',
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
      onRequestPrepared,
      onRequestSettled,
      dependencies: {
        trimMessagesToFit,
        runModelTurn: vi.fn(async (options) => {
          lifecycleOrder.push('provider')
          return runModelTurn(options)
        })
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
    expect(onRequestPrepared).toHaveBeenCalledWith({
      beforeMessages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('maximum') })
      ]),
      messages: trimmedMessages
    })
    expect(onRequestSettled).toHaveBeenCalledWith('request-1', {
      role: 'assistant',
      content: 'Final answer.'
    })
    expect(lifecycleOrder).toEqual(['prepared', 'provider', 'settled'])
    expect(result.messages).toBe(trimmedMessages)
    expect(result.finalMessage).toEqual({ role: 'assistant', content: 'Final answer.' })
  })

  it('emits assistant content when the final turn did not stream text', async () => {
    const emitFinal = vi.fn()

    await runForcedFinalTurn({
      messages: [],
      reason: 'loop_guard',
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

  it('uses a distinct prompt for the emergency safety limit', async () => {
    const trimMessagesToFit = vi.fn((messages: ChatCompletionMessage[]) => messages)

    await runForcedFinalTurn({
      messages: [],
      reason: 'safety_limit',
      signal: new AbortController().signal,
      modelConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      contextSize: 8000,
      usageTracker: createRunUsageTracker(),
      emitReasoning: vi.fn(),
      emitFinal: vi.fn(),
      dependencies: {
        trimMessagesToFit,
        runModelTurn: vi.fn(async () => ({
          assistantMessage: { role: 'assistant', content: 'Safety final.' },
          streamedText: ''
        }))
      }
    })

    expect(trimMessagesToFit).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content:
            'The emergency safety limit for this agent run has been reached. Please provide the best final answer you can based only on the observations available.'
        }
      ],
      expect.any(Object)
    )
  })
})
