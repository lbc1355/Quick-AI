import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import {
  callModel,
  getPromptCacheStats,
  prepareMessagesForModel,
  resolveApiFormat
} from './callModel'
import { chatMessagesToResponsesInput } from './responsesAdapter'
import { ChatCompletionMessage } from '../../shared/types'

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

describe('resolveApiFormat', () => {
  it('rejects an API format that the selected provider adapter does not support', () => {
    expect(() =>
      resolveApiFormat({
        apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'k',
        model: 'glm-4.5',
        providerType: 'glm',
        apiFormat: 'responses'
      })
    ).toThrow('does not support the responses API format')
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

  it('promotes a reasoning-only terminal response to final content', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        sseStream([sseLine({ reasoning_content: 'Hello from the gateway.' }), 'data: [DONE]\n'])
      )
    )

    const onReasoning = vi.fn()
    const onFinalChunk = vi.fn()
    const result = await callModel(
      { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'hi' }],
      undefined,
      undefined,
      { onReasoning, onFinalChunk }
    )

    expect(result.content).toBe('Hello from the gateway.')
    expect(result.reasoning_content).toBe('Hello from the gateway.')
    expect(onReasoning).toHaveBeenCalledWith('Hello from the gateway.')
    expect(onFinalChunk).toHaveBeenCalledOnce()
    expect(onFinalChunk).toHaveBeenCalledWith('Hello from the gateway.')
  })

  it('does not promote reasoning from a tool-call turn', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        sseStream([
          sseLine({ reasoning_content: 'I need to inspect the file.' }),
          sseLine({
            tool_calls: [
              {
                index: 0,
                id: 'call-read',
                function: { name: 'file_read', arguments: '{"path":"README.md"}' }
              }
            ]
          }),
          'data: [DONE]\n'
        ])
      )
    )

    const onFinalChunk = vi.fn()
    const result = await callModel(
      { apiUrl: 'https://api.example.com', apiKey: 'k', model: 'test-model' },
      [{ role: 'user', content: 'read the file' }],
      undefined,
      undefined,
      { onReasoning: vi.fn(), onFinalChunk }
    )

    expect(result.content).toBe('')
    expect(result.tool_calls).toHaveLength(1)
    expect(onFinalChunk).not.toHaveBeenCalled()
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

  it('lets resolved model features override adapter stream-usage defaults', async () => {
    fetchMock.mockResolvedValue(
      okResponse(sseStream([sseLine({ content: 'Hello' }), 'data: [DONE]\n']))
    )

    await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'custom-model',
        modelRuntime: {
          providerType: 'custom',
          endpointType: 'openai-compatible',
          modelId: 'custom-model',
          apiModel: 'custom-model',
          features: {
            toolCalls: true,
            parallelToolCalls: false,
            reasoning: false,
            vision: false,
            promptCaching: false,
            streamUsage: false
          }
        }
      },
      [{ role: 'user', content: 'hi' }]
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stream_options).toBeUndefined()
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

describe('Responses API Compatibility', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('correctly maps chat messages to Responses input format', () => {
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Hi there!',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"NYC"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Rainy' }
    ]
    const { instructions, input } = chatMessagesToResponsesInput(messages)
    expect(instructions).toBe('You are a helpful assistant.')
    expect(input).toHaveLength(4)
    expect(input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello' }]
    })
    expect(input[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hi there!' }]
    })
    expect(input[2]).toEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"NYC"}'
    })
    expect(input[3]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: 'Rainy' })
  })

  it('routes to callResponsesModel and streams text/reasoning correctly', async () => {
    const responseStream = sseStream([
      'event: response.output_text.delta\ndata: {"delta":"Hello"}\n',
      'event: response.reasoning_summary_text.delta\ndata: {"delta":"Thinking"}\n',
      'event: response.completed\ndata: {"response":{"usage":{"prompt_tokens":100,"prompt_cache_hit_tokens":40}}}\n',
      'data: [DONE]\n'
    ])
    fetchMock.mockResolvedValue(okResponse(responseStream))

    const onFinalChunk = vi.fn()
    const onReasoning = vi.fn()

    const result = await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'test-model',
        apiFormat: 'responses'
      },
      [{ role: 'user', content: 'hi' }],
      undefined,
      undefined,
      { onReasoning, onFinalChunk }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/responses')
    expect(result.content).toBe('Hello')
    expect(result.reasoning_content).toBe('Thinking')
    expect(onFinalChunk).toHaveBeenCalledWith('Hello')
    expect(onReasoning).toHaveBeenCalledWith('Thinking')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.store).toBe(false)
    expect(body.model).toBe('test-model')

    expect(getPromptCacheStats(result)).toEqual({
      hasCacheStats: true,
      promptTokens: 100,
      completionTokens: undefined,
      totalTokens: undefined,
      reasoningTokens: undefined,
      cacheHitTokens: 40,
      cacheMissTokens: 60,
      hitRate: 40
    })
  })

  it('promotes a reasoning-only Responses result to final content', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        sseStream([
          'event: response.reasoning_summary_text.delta\ndata: {"delta":"Gateway answer"}\n',
          'event: response.completed\ndata: {"response":{}}\n',
          'data: [DONE]\n'
        ])
      )
    )

    const onFinalChunk = vi.fn()
    const result = await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'test-model',
        apiFormat: 'responses'
      },
      [{ role: 'user', content: 'hi' }],
      undefined,
      undefined,
      { onReasoning: vi.fn(), onFinalChunk }
    )

    expect(result.content).toBe('Gateway answer')
    expect(onFinalChunk).toHaveBeenCalledWith('Gateway answer')
  })

  it('accumulates streamed function calls correctly', async () => {
    const responseStream = sseStream([
      'event: response.output_item.added\ndata: {"item":{"id":"fc_99","call_id":"call_99","type":"function_call","name":"file_write"}}\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_99","delta":"{\\"pa"}\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_99","delta":"th\\":\\"a.txt\\"}"}\n',
      'event: response.function_call_arguments.done\ndata: {"item_id":"fc_99","arguments":"{\\"path\\":\\"a.txt\\"}"}\n',
      'data: [DONE]\n'
    ])
    fetchMock.mockResolvedValue(okResponse(responseStream))

    const result = await callModel(
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'k',
        model: 'test-model',
        apiFormat: 'responses'
      },
      [{ role: 'user', content: 'hi' }],
      [
        {
          type: 'function',
          function: {
            name: 'file_write',
            description: 'desc',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]
    )

    expect(result.tool_calls).toBeDefined()
    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls![0]).toEqual({
      id: 'call_99',
      type: 'function',
      function: { name: 'file_write', arguments: '{"path":"a.txt"}' }
    })
  })
})
