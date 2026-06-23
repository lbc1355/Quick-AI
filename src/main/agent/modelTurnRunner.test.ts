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
      streamedText: 'Final content',
      cacheStats: {
        promptTokens: 10,
        completionTokens: 2,
        cacheHitTokens: 7,
        hitRate: 70
      }
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
  it('decorates cache stats before recording usage', async () => {
    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content: 'Final content'
    }
    const callModel = vi.fn(async () => assistantMessage)
    const usageTracker = createRunUsageTracker()
    const recordSpy = vi.spyOn(usageTracker, 'recordModelResponse')

    const result = await runModelTurn({
      modelConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        model: 'model'
      },
      messages: [{ role: 'user', content: 'Hello' }],
      toolsToDeclare: [],
      usageTracker,
      callModel,
      getPromptCacheStats: () => ({
        promptTokens: 10,
        cacheHitTokens: 7,
        cacheMissTokens: 3,
        hitRate: 70
      }),
      decorateCacheStats: (stats) =>
        stats
          ? {
              ...stats,
              cacheDiagnostics: {
                prefixHash: 'p',
                prefixChanged: false,
                prefixChangeReasons: [],
                systemHash: 's',
                toolsHash: 't',
                messageShapeHash: 'm',
                messageCount: 1,
                toolSchemaTokens: 0
              }
            }
          : undefined,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200),
      onReasoning: vi.fn(),
      onContentChunk: vi.fn()
    })

    expect(result.cacheStats?.cacheDiagnostics).toMatchObject({ prefixHash: 'p' })
    expect(recordSpy).toHaveBeenCalledWith(
      assistantMessage,
      100,
      expect.objectContaining({ cacheDiagnostics: expect.objectContaining({ prefixHash: 'p' }) })
    )
  })
})
