import { describe, expect, it } from 'vitest'
import { createProviderModelDiscoveryPolicy } from './providerRegistry'
import {
  mergeDiscoveredModelMetadata,
  normalizeProviderModelDiscoveryResponse,
  resolveProviderModelDiscoveryUrl
} from './providerModelDiscovery'

describe('provider model discovery', () => {
  it('normalizes OpenAI-compatible metadata and removes duplicate ids', () => {
    const policy = createProviderModelDiscoveryPolicy()
    expect(
      normalizeProviderModelDiscoveryResponse(
        {
          data: [
            {
              id: 'model-a',
              display_name: 'Model A',
              max_context_tokens: '64000',
              capabilities: ['text', 'tool_calls', 'thinking']
            },
            { id: 'model-a' },
            { id: 'model-b' }
          ]
        },
        policy
      )
    ).toEqual([
      {
        id: 'model-a',
        displayName: 'Model A',
        contextWindowTokens: 64000,
        capabilities: ['text', 'tools', 'reasoning']
      },
      { id: 'model-b' }
    ])
  })

  it('supports Ollama-style and plain string collections', () => {
    const policy = createProviderModelDiscoveryPolicy()
    expect(
      normalizeProviderModelDiscoveryResponse(
        { models: [{ name: 'llama3' }, { model: 'deepseek-r1:8b' }] },
        policy
      )
    ).toEqual([{ id: 'llama3' }, { id: 'deepseek-r1:8b' }])
    expect(normalizeProviderModelDiscoveryResponse(['a', 'b'], policy)).toEqual([
      { id: 'a' },
      { id: 'b' }
    ])
  })

  it('supports declarative nested response fields', () => {
    const policy = createProviderModelDiscoveryPolicy({
      collectionPaths: ['payload.items'],
      idPaths: ['slug'],
      displayNamePaths: ['metadata.title'],
      contextWindowPaths: ['limits.input'],
      capabilityPaths: ['metadata.modalities']
    })
    expect(
      normalizeProviderModelDiscoveryResponse(
        {
          payload: {
            items: [
              {
                slug: 'nested-model',
                metadata: { title: 'Nested', modalities: ['text', 'image'] },
                limits: { input: 128000 }
              }
            ]
          }
        },
        policy
      )
    ).toEqual([
      {
        id: 'nested-model',
        displayName: 'Nested',
        contextWindowTokens: 128000,
        capabilities: ['text', 'vision']
      }
    ])
  })

  it('resolves the registered endpoint path against a provider base URL', () => {
    expect(resolveProviderModelDiscoveryUrl('glm', 'https://example.com/v1/')).toBe(
      'https://example.com/v1/models'
    )
    expect(resolveProviderModelDiscoveryUrl('custom', '')).toBe('')
  })

  it('merges discovered display names and capabilities into the model catalog', () => {
    const provider = mergeDiscoveredModelMetadata(
      {
        id: 'custom-provider',
        name: 'Custom',
        type: 'custom',
        apiKey: '',
        apiUrl: 'https://example.com/v1',
        model: 'vision-model',
        modelsList: ['vision-model']
      },
      [
        {
          id: 'vision-model',
          displayName: 'Vision Model',
          capabilities: ['text', 'vision', 'tools']
        }
      ]
    )

    expect(provider.models?.['vision-model']).toMatchObject({
      displayName: 'Vision Model',
      capabilities: ['text', 'vision', 'tools']
    })
  })

  it('parses OpenCode DeepSeek reasoning_options arrays into effort controls', () => {
    const models = normalizeProviderModelDiscoveryResponse(
      {
        data: [
          {
            id: 'deepseek-v4-pro',
            reasoning: true,
            reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['high', 'max'] }]
          }
        ]
      },
      createProviderModelDiscoveryPolicy(),
      { providerType: 'opencode' }
    )

    expect(models[0]).toMatchObject({
      id: 'deepseek-v4-pro',
      capabilities: ['reasoning'],
      discoveredReasoningControl: {
        mode: 'effort',
        encoding: 'openai-effort',
        levels: ['high', 'max']
      }
    })
  })

  it('treats reasoning=true with empty options as a reasoning capability (fixed at resolve)', () => {
    const models = normalizeProviderModelDiscoveryResponse(
      {
        data: [{ id: 'fixed-reasoner', reasoning: true, reasoning_options: [] }]
      },
      createProviderModelDiscoveryPolicy()
    )

    expect(models[0]).toEqual({
      id: 'fixed-reasoner',
      capabilities: ['reasoning']
    })
    expect(models[0].discoveredReasoningControl).toBeUndefined()
  })
})
