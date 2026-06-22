import { describe, expect, it } from 'vitest'
import { ApiProvider } from './types'
import {
  getProviderModelContextWindowInfo,
  getProviderModelRuntimeConfig,
  getProviderModels,
  normalizeProviderModelCatalog
} from './modelCatalog'

const provider = (overrides: Partial<ApiProvider> = {}): ApiProvider => ({
  id: 'provider-glm',
  name: 'GLM',
  type: 'glm',
  apiKey: '',
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.5-air',
  modelsList: ['glm-4.5-air'],
  ...overrides
})

describe('modelCatalog', () => {
  it('builds a model catalog from legacy model lists and context windows', () => {
    const normalized = normalizeProviderModelCatalog(
      provider({
        modelsList: ['glm-4.5-air', 'custom-32k'],
        modelContextWindows: { 'glm-4.5-air': 96000 }
      })
    )

    expect(normalized.modelsList).toEqual(['glm-4.5-air', 'custom-32k'])
    expect(Object.keys(normalized.models || {})).toEqual(['glm-4.5-air', 'custom-32k'])
    expect(normalized.models?.['glm-4.5-air']).toMatchObject({
      id: 'glm-4.5-air',
      apiId: 'glm-4.5-air',
      providerId: 'provider-glm',
      endpointType: 'openai-compatible',
      enabled: true,
      limit: { context: 96000 }
    })
    expect(normalized.models?.['custom-32k']?.limit.context).toBe(32000)
  })

  it('prefers model catalog context over legacy context window overrides', () => {
    const normalized = normalizeProviderModelCatalog(
      provider({
        modelsList: ['glm-4.5-air'],
        modelContextWindows: { 'glm-4.5-air': 64000 },
        models: {
          'glm-4.5-air': {
            id: 'glm-4.5-air',
            apiId: 'glm-4.5-air',
            providerId: 'provider-glm',
            endpointType: 'openai-compatible',
            enabled: true,
            limit: { context: 256000, output: 8192 }
          }
        }
      })
    )

    expect(getProviderModelContextWindowInfo(normalized, 'glm-4.5-air')).toEqual({
      tokens: 256000,
      source: 'model-catalog'
    })
  })

  it('returns enabled models in provider list order', () => {
    const normalized = normalizeProviderModelCatalog(
      provider({
        modelsList: ['b-model', 'a-model'],
        models: {
          'a-model': {
            id: 'a-model',
            apiId: 'a-model',
            providerId: 'provider-glm',
            endpointType: 'openai-compatible',
            enabled: true,
            limit: { context: 128000 }
          },
          'b-model': {
            id: 'b-model',
            apiId: 'b-model',
            providerId: 'provider-glm',
            endpointType: 'openai-compatible',
            enabled: true,
            limit: { context: 128000 }
          },
          disabled: {
            id: 'disabled',
            apiId: 'disabled',
            providerId: 'provider-glm',
            endpointType: 'openai-compatible',
            enabled: false,
            limit: { context: 128000 }
          }
        }
      })
    )

    expect(getProviderModels(normalized).map((model) => model.id)).toEqual(['b-model', 'a-model'])
  })

  it('builds a model runtime config using the API model id', () => {
    const normalized = normalizeProviderModelCatalog(
      provider({
        modelsList: ['friendly-name'],
        models: {
          'friendly-name': {
            id: 'friendly-name',
            apiId: 'real-api-model',
            providerId: 'provider-glm',
            endpointType: 'openai-compatible',
            capabilities: ['text', 'tools'],
            limit: { context: 256000 },
            enabled: true
          }
        }
      })
    )

    expect(getProviderModelRuntimeConfig(normalized, 'friendly-name')).toEqual({
      providerId: 'provider-glm',
      providerType: 'glm',
      endpointType: 'openai-compatible',
      modelId: 'friendly-name',
      apiModel: 'real-api-model',
      displayName: undefined,
      capabilities: ['text', 'tools'],
      contextWindowTokens: 256000
    })
  })

  it('falls back to a generated runtime config for uncatalogued models', () => {
    const runtime = getProviderModelRuntimeConfig(provider(), 'custom-32k')

    expect(runtime).toMatchObject({
      providerId: 'provider-glm',
      providerType: 'glm',
      endpointType: 'openai-compatible',
      modelId: 'custom-32k',
      apiModel: 'custom-32k',
      contextWindowTokens: 32000
    })
  })
})
