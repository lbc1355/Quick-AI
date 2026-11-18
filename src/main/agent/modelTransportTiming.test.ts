import { afterEach, describe, expect, it, vi } from 'vitest'
import { callModel } from './callModel'
import type { ModelTransportId } from '../../shared/types'
import type { ModelTimingEvent } from '../../shared/runTiming'

describe('provider transport timing integration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each<ModelTransportId>(['openai-chat-completions', 'openai-responses'])(
    'records HTTP and semantic output boundaries for %s',
    async (transportId) => {
      const events: ModelTimingEvent[] = []
      const text =
        transportId === 'openai-responses'
          ? ': heartbeat\n\nevent: response.reasoning_summary_text.delta\ndata: {"delta":"plan"}\n\nevent: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {}\n\n'
          : ': heartbeat\n\ndata: {"choices":[{"delta":{"reasoning_content":"plan"}}]}\n\ndata: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'
      const fetchMock = vi.fn(async () => new Response(text, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      await callModel(
        { apiUrl: 'https://gateway.example/v1', model: 'test', transportId },
        [{ role: 'user', content: 'hello' }],
        undefined,
        undefined,
        { onReasoning: () => {}, onFinalChunk: () => {}, onTiming: (event) => events.push(event) }
      )
      expect(events.map((event) => event.phase)).toEqual([
        'http_request',
        'response_headers',
        'first_body_chunk',
        'first_model_output',
        'model_complete'
      ])
      expect(events[1].status).toBe(200)
      expect(events[3].outputKind).toBe('reasoning')
      expect(events[4].outcome).toBe('success')
      expect(events.every((event) => event.attempt === 1 && event.attemptElapsedMs >= 0)).toBe(true)
      const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      expect(request.body).not.toContain('onTiming')
      expect(request.body).not.toContain('startupTiming')
    }
  )

  it('records HTTP failures without inventing a first model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid key', { status: 401 }))
    )
    const events: ModelTimingEvent[] = []
    await expect(
      callModel(
        { apiUrl: 'https://gateway.example/v1', model: 'test' },
        [{ role: 'user', content: 'hello' }],
        undefined,
        undefined,
        { onReasoning: () => {}, onFinalChunk: () => {}, onTiming: (event) => events.push(event) }
      )
    ).rejects.toThrow('401')
    expect(events.map((event) => event.phase)).toEqual([
      'http_request',
      'response_headers',
      'model_complete'
    ])
    expect(events[2].outcome).toBe('error')
  })
})
