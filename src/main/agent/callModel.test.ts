import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import { callModel, getPromptCacheStats, prepareMessagesForModel } from './callModel'

const encoder = new TextEncoder()

const sseLine = (delta: object): string => `data: ${JSON.stringify({ choices: [{ delta }] })}\n`
const sseUsageLine = (usage: object): string => `data: ${JSON.stringify({ choices: [], usage })}\n`

const sseStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    }
  })
}

const okResponse = (stream: ReadableStream<Uint8Array>): Response =>
  ({ ok: true, body: stream }) as unknown as Response

describe('prepareMessagesForModel', () => {
  it('removes non-empty assistant reasoning content from request history', () => {
    const messages = prepareMessagesForModel([
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'I need to inspect the project first.',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'file_read', arguments: '{"path":"src/main/index.ts"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', name: 'file_read', content: 'file contents' }
    ])

    expect(messages[1]).toMatchObject({ role: 'assistant' })
    expect(messages[1]).not.toHaveProperty('reasoning_content')
    expect(messages[1].tool_calls).toHaveLength(1)
  })

  it('removes empty assistant reasoning content from request history', () => {
    const messages = prepareMessagesForModel([
      { role: 'assistant', content: 'done', reasoning_content: '' }
    ])

    expect(messages[0]).not.toHaveProperty('reasoning_content')
  })
})

describe('callModel retry behavior', () => {
  let fetchMock: Mock

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a transient network failure that occurs before any output', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        okResponse(sseStream([sseLine({ content: 'Hello' }), 'data: [DONE]\n']))
      )

    const onFinalChunk = vi.fn()
    const promise = callModel(
      { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'hi' }],
      undefined,
      undefined,
      { onReasoning: vi.fn(), onFinalChunk }
    )

    // First attempt fails -> backoff timer (1000ms) -> second attempt succeeds
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('Hello')
    expect(onFinalChunk).toHaveBeenCalledTimes(1)
    expect(onFinalChunk).toHaveBeenCalledWith('Hello')
  })

  it('does not retry a non-retryable API error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key'
    } as unknown as Response)

    await expect(
      callModel({ apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' }, [
        { role: 'user', content: 'hi' }
      ])
    ).rejects.toThrow('API Error: 401 - invalid api key')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry once user-visible output has started streaming', async () => {
    // Reading a real ReadableStream relies on the runtime scheduler; use real timers here.
    // No backoff delay is exercised in this case (a streamed failure is never retried).
    vi.useRealTimers()
    let stage = 0
    const brokenStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (stage === 0) {
          stage++
          controller.enqueue(encoder.encode(sseLine({ content: 'partial answer' })))
        } else {
          controller.error(new TypeError('fetch failed'))
        }
      }
    })
    fetchMock.mockResolvedValue(okResponse(brokenStream))

    const onFinalChunk = vi.fn()
    await expect(
      callModel(
        { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
        [{ role: 'user', content: 'hi' }],
        undefined,
        undefined,
        { onReasoning: vi.fn(), onFinalChunk }
      )
    ).rejects.toThrow('fetch failed')

    // No second attempt: retrying would duplicate the already-streamed chunk
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onFinalChunk).toHaveBeenCalledWith('partial answer')
  })

  it('gives up after retries are exhausted on persistent transient failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const promise = callModel(
      { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'hi' }]
    )
    const assertion = expect(promise).rejects.toThrow('fetch failed')

    // maxRetries = 2 -> backoffs of 1000ms then 2000ms before the final failing attempt
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    await assertion

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses explicit runtime adapter and API model id instead of guessing from URL', async () => {
    fetchMock.mockResolvedValue(
      okResponse(sseStream([sseLine({ content: 'Hello' }), 'data: [DONE]\n']))
    )

    await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'friendly-name',
        modelRuntime: {
          providerType: 'glm',
          endpointType: 'openai-compatible',
          modelId: 'friendly-name',
          apiModel: 'real-glm-model',
          capabilities: ['text', 'tools'],
          contextWindowTokens: 128000
        }
      },
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: {
            name: 'search_tools',
            description: 'Search tools',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('real-glm-model')
    expect(body.tools).toHaveLength(1)
    expect(body.tool_choice).toBeUndefined()
  })

  it('does not declare tools when the selected model runtime explicitly lacks tool capability', async () => {
    fetchMock.mockResolvedValue(
      okResponse(sseStream([sseLine({ content: 'Hello' }), 'data: [DONE]\n']))
    )

    await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'text-only',
        modelRuntime: {
          providerType: 'custom',
          endpointType: 'openai-compatible',
          modelId: 'text-only',
          apiModel: 'text-only',
          capabilities: ['text'],
          contextWindowTokens: 128000
        }
      },
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: {
            name: 'search_tools',
            description: 'Search tools',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })

  it('reports tool call argument streaming progress', async () => {
    const generatedLines = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\\n')
    fetchMock.mockResolvedValue(
      okResponse(
        sseStream([
          sseLine({
            tool_calls: [
              {
                index: 0,
                id: 'call-write',
                function: { name: 'file_write', arguments: '' }
              }
            ]
          }),
          sseLine({
            tool_calls: [
              {
                index: 0,
                function: { arguments: '{"path":"out.txt","content":"' }
              }
            ]
          }),
          sseLine({
            tool_calls: [
              {
                index: 0,
                function: { arguments: generatedLines }
              }
            ]
          }),
          sseLine({
            tool_calls: [
              {
                index: 0,
                function: { arguments: '"}' }
              }
            ]
          }),
          'data: [DONE]\n'
        ])
      )
    )

    const onToolCallProgress = vi.fn()
    const result = await callModel(
      { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'write the file' }],
      undefined,
      undefined,
      { onReasoning: vi.fn(), onFinalChunk: vi.fn(), onToolCallProgress }
    )

    expect(result.tool_calls?.[0]).toMatchObject({
      id: 'call-write',
      function: { name: 'file_write' }
    })
    expect(result.tool_calls?.[0].function.arguments).toContain(generatedLines)
    expect(onToolCallProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 0,
        id: 'call-write',
        toolName: 'file_write',
        argumentsLength: 0,
        argumentsDeltaLength: 0,
        generatedLineCount: 0
      })
    )
    expect(
      onToolCallProgress.mock.calls.some(
        ([progress]) => progress.toolName === 'file_write' && progress.generatedLineCount >= 80
      )
    ).toBe(true)
  })
  it('extracts prompt cache stats from streaming usage chunks', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        sseStream([
          sseLine({ content: 'Hello' }),
          sseUsageLine({
            prompt_tokens: 100,
            prompt_cache_hit_tokens: 75,
            prompt_cache_miss_tokens: 25
          }),
          'data: [DONE]\n'
        ])
      )
    )

    const result = await callModel(
      { apiUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'hi' }]
    )

    expect(getPromptCacheStats(result)).toEqual({
      hasCacheStats: true,
      promptTokens: 100,
      completionTokens: undefined,
      totalTokens: undefined,
      reasoningTokens: undefined,
      cacheHitTokens: 75,
      cacheMissTokens: 25,
      hitRate: 75
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stream_options).toEqual({ include_usage: true })
  })
})
