import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../../shared/types'
import { getProviderRegistration } from '../../../shared/providerRegistry'
import { createProviderFromRegistration } from '../../../shared/providerFactory'
import { ensureCoreProviderPresets } from './providerPresets'

describe('providerPresets', () => {
  it('builds registered providers with normalized model catalog metadata', () => {
    const registration = getProviderRegistration('opencode')
    expect(registration).toBeDefined()

    const provider = createProviderFromRegistration(registration!)

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
      providerPresetVersion: 3
    }

    const { settings: repaired, changed } = ensureCoreProviderPresets(settings)

    expect(changed).toBe(true)
    expect(repaired.providers[0].models?.['deepseek-v4-flash-free']?.limit.context).toBe(128000)
  })

  it('uses the shared registration for step defaults', () => {
    const registration = getProviderRegistration('step')
    expect(registration).toBeDefined()
    expect(registration?.definition.name).toBe('阶跃星辰')
    expect(registration?.accountDefaults.apiUrl).toBe('https://api.stepfun.com/step_plan/v1')

    const provider = createProviderFromRegistration(registration!)
    expect(provider.modelsList).toContain('step-3.7-flash')
    expect(provider.models?.['step-3.7-flash']).toBeDefined()
  })
})
