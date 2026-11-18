import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatCompletionMessage,
  ChatToolDeclaration,
  ModelTransportId
} from '../../shared/types'
import { toWellFormedText } from '../../shared/unicodeText'
import { callModel } from './callModel'

describe('model request Unicode compatibility', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each<ModelTransportId>(['openai-chat-completions', 'openai-responses'])(
    'sends only well-formed strings through %s, including history and custom fields',
    async (transportId) => {
      const text = '中文 🌟 history \ud83c'
      const messages: ChatCompletionMessage[] = [
        { role: 'system', content: text },
        { role: 'user', content: [{ type: 'text', text }] },
        {
          role: 'assistant',
          content: text,
          reasoning_content: text,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"\ud83c"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1', content: text }
      ]
      const tools: ChatToolDeclaration[] = [
        {
          type: 'function',
          function: {
            name: 'read',
            description: text,
            parameters: {
              type: 'object',
              properties: { path: { type: 'string', description: text } }
            }
          }
        }
      ]
      const response =
        transportId === 'openai-responses'
          ? 'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {}\n\n'
          : 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'
      const fetchMock = vi.fn(async () => new Response(response))
      vi.stubGlobal('fetch', fetchMock)

      await callModel(
        {
          apiUrl: 'https://gateway.example/v1',
          apiKey: 'test',
          model: 'test',
          modelRuntime: {
            providerType: 'custom',
            modelId: 'test',
            apiModel: 'test',
            transportId,
            requestBodyOverrides: { metadata: { note: text } }
          }
        },
        messages,
        tools
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      const encoded = request.body as string
      expect(encoded).not.toContain('\\ud83c')
      expect(encoded).toContain('中文 🌟 history �')
      const decoded = JSON.parse(encoded)
      const checkStrings = (value: unknown): void => {
        if (typeof value === 'string') expect(value).toBe(toWellFormedText(value))
        else if (value && typeof value === 'object') Object.values(value).forEach(checkStrings)
      }
      checkStrings(decoded)
      expect(decoded.metadata.note).toBe('中文 🌟 history �')
      expect(messages[0].content).toBe(text)
      expect(tools[0].function.description).toBe(text)
    }
  )
})
