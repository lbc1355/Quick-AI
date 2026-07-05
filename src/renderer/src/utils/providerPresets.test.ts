import { describe, expect, it } from 'vitest'
import {
  buildProviderFromPreset,
  ensureCoreProviderPresets,
  getProviderPreset
} from './providerPresets'
import { AppSettings } from '../../../shared/types'

describe('providerPresets', () => {
  it('builds preset providers with normalized model catalog metadata', () => {
    const preset = getProviderPreset('opencode')
    expect(preset).toBeDefined()

    const provider = buildProviderFromPreset(preset!)

    expect(provider.modelsList).toEqual([
      'deepseek-v4-flash-free',
      'deepseek-v4-pro',
      'qwen3-coder-plus'
    ])
    expect(provider.models?.['deepseek-v4-flash-free']).toMatchObject({
      id: 'deepseek-v4-flash-free',
      apiId: 'deepseek-v4-flash-free',
      providerId: 'provider-opencode',
      endpointType: 'openai-compatible',
      enabled: true,
      limit: { context: 128000 }
    })
  })

  it('upgrades existing provider settings to include model catalogs', () => {
    const settings: AppSettings = {
      providers: [
        {
          id: 'custom-glm',
          name: 'GLM',
          type: 'glm',
          apiKey: '',
          apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.5-air',
          modelsList: ['glm-4.5-air'],
          modelContextWindows: { 'glm-4.5-air': 64000 }
        }
      ],
      activeProviderId: 'custom-glm',
      systemPrompt: '',
      autoHideOnBlur: true,
      providerPresetVersion: 0
    }

    const { settings: upgraded } = ensureCoreProviderPresets(settings)

    expect(upgraded.providers[0].models?.['glm-4.5-air']?.limit.context).toBe(64000)
    expect(upgraded.providers[0].endpointType).toBe('openai-compatible')
  })

  it('repairs missing model catalog metadata even when preset version is current', () => {
    const settings: AppSettings = {
      providers: [
        {
          id: 'provider-opencode',
          name: 'opencode',
          type: 'opencode',
          apiKey: '',
          apiUrl: 'https://opencode.ai/zen/v1',
          model: 'deepseek-v4-flash-free',
          modelsList: ['deepseek-v4-flash-free']
        }
      ],
      activeProviderId: 'provider-opencode',
      systemPrompt: '',
      autoHideOnBlur: true,
      providerPresetVersion: 2
    }

    const { settings: repaired, changed } = ensureCoreProviderPresets(settings)

    expect(changed).toBe(true)
    expect(repaired.providers[0].models?.['deepseek-v4-flash-free']?.limit.context).toBe(128000)
  })

  it('builds step preset provider correctly', () => {
    const preset = getProviderPreset('step')
    expect(preset).toBeDefined()
    expect(preset?.name).toBe('阶跃星辰')
    expect(preset?.apiUrl).toBe('https://api.stepfun.com/step_plan/v1')

    const provider = buildProviderFromPreset(preset!)
    expect(provider.modelsList).toContain('step-3.7-flash')
    expect(provider.models?.['step-3.7-flash']).toBeDefined()
  })
})
