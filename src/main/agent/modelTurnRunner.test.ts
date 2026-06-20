import { describe, expect, it, vi } from 'vitest'

import { ChatCompletionMessage } from '../../shared/types'
import { createRunUsageTracker } from './runUsageTracker'
import { runModelTurn } from './modelTurnRunner'

describe('runModelTurn', () => {
  it('calls the model, forwards streamed chunks, and records usage', async () => {
    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: 'Final content',
      reasoning_content: 'Reasoning'
    }
    const callModel = vi.fn(async (_config, _messages, _tools, _signal, callbacks) => {
      callbacks?.onReasoning('Reasoning')
      callbacks?.onFinalChunk('Final ')
      callbacks?.onFinalChunk('content')
      return assistantMessage
    })
    const usageTracker = createRunUsageTracker()
    const recordSpy = vi.spyOn(usageTracker, 'recordModelResponse')
    const onReasoning = vi.fn()
    const onContentChunk = vi.fn()
    const signal = new AbortController().signal

    const result = await runModelTurn({
      modelConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      messages: [{ role: 'user', content: 'Hello' }],
      toolsToDeclare: [],
      signal,
      usageTracker,
      callModel,
      getPromptCacheStats: () => ({
        promptTokens: 10,
        completionTokens: 2,
        cacheHitTokens: 7,
        hitRate: 70
      }),
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(350),
      onReasoning,
      onContentChunk
    })

    expect(result).toEqual({
      assistantMessage,
      streamedText: 'Final content'
    })
    expect(callModel).toHaveBeenCalledWith(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      [{ role: 'user', content: 'Hello' }],
      [],
      signal,
      expect.any(Object)
    )
    expect(onReasoning).toHaveBeenCalledWith('Reasoning')
    expect(onContentChunk).toHaveBeenNthCalledWith(1, 'Final ')
    expect(onContentChunk).toHaveBeenNthCalledWith(2, 'content')
    expect(recordSpy).toHaveBeenCalledWith(assistantMessage, 250, {
      promptTokens: 10,
      completionTokens: 2,
      cacheHitTokens: 7,
      hitRate: 70
    })
  })
})
