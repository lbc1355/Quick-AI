import { ApiProvider, AppSettings } from '../../../shared/types'
import { normalizeProviderModelCatalog } from '../../../shared/modelCatalog'

export interface ProviderPreset {
  type: ApiProvider['type']
  name: string
  apiUrl: string
  modelsList: string[]
  defaultModel: string
}

export const PROVIDER_PRESET_VERSION = 3

const CORE_PROVIDER_TYPES: ApiProvider['type'][] = ['opencode', 'glm', 'kimi', 'mimo', 'step']

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: 'opencode',
    name: 'opencode',
    apiUrl: 'https://opencode.ai/zen/v1',
    modelsList: ['deepseek-v4-flash-free', 'deepseek-v4-pro', 'qwen3-coder-plus'],
    defaultModel: 'deepseek-v4-flash-free'
  },
  {
    type: 'glm',
    name: 'GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelsList: ['glm-4.5-air', 'glm-4.5', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-4-flash'],
    defaultModel: 'glm-4.5-air'
  },
  {
    type: 'kimi',
    name: 'Kimi',
    apiUrl: 'https://api.moonshot.cn/v1',
    modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
    defaultModel: 'moonshot-v1-8k'
  },
  {
    type: 'mimo',
    name: 'MiMo',
    apiUrl: 'https://api.mimo.xiaomi.com/v1',
    modelsList: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-flash'],
    defaultModel: 'mimo-v2.5-pro'
  },
  {
    type: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1',
    modelsList: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat'
  },
  {
    type: 'ollama',
    name: 'Local Ollama',
    apiUrl: 'http://localhost:11434/v1',
    modelsList: ['deepseek-r1:8b', 'llama3'],
    defaultModel: 'deepseek-r1:8b'
  },
  {
    type: 'step',
    name: '阶跃星辰',
    apiUrl: 'https://api.stepfun.com/v1',
    modelsList: ['step-1-8k', 'step-1-32k', 'step-1-128k', 'step-2-16k'],
    defaultModel: 'step-1-8k'
  },
  {
    type: 'custom',
    name: '自定义服务商',
    apiUrl: '',
    modelsList: ['custom-model'],
    defaultModel: 'custom-model'
  }
]

export const getProviderPreset = (type: ApiProvider['type']): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((preset) => preset.type === type)

export const getProviderTypeLabel = (type: ApiProvider['type']): string =>
  getProviderPreset(type)?.name || type

export const buildProviderFromPreset = (preset: ProviderPreset): ApiProvider =>
  normalizeProviderModelCatalog({
    id: `provider-${preset.type}`,
    name: preset.name,
    type: preset.type,
    apiKey: '',
    apiUrl: preset.apiUrl,
    model: preset.defaultModel,
    modelsList: [...preset.modelsList]
  })

const providerMatchesPreset = (provider: ApiProvider, preset: ProviderPreset): boolean => {
  if (provider.type === preset.type) return true
  if (provider.name.trim().toLowerCase() === preset.name.toLowerCase()) return true
  if (preset.apiUrl && provider.apiUrl.trim().toLowerCase() === preset.apiUrl.toLowerCase()) {
    return true
  }
  return false
}

export function ensureCoreProviderPresets(settings: AppSettings): {
  settings: AppSettings
  changed: boolean
} {
  const shouldInstallCorePresets = (settings.providerPresetVersion || 0) < PROVIDER_PRESET_VERSION
  const providers = [...(settings.providers || [])]
  let changed = false

  if (shouldInstallCorePresets) {
    for (const type of CORE_PROVIDER_TYPES) {
      const preset = getProviderPreset(type)
      if (!preset) continue
      const exists = providers.some((provider) => providerMatchesPreset(provider, preset))
      if (!exists) {
        providers.push(buildProviderFromPreset(preset))
        changed = true
      }
    }
  }

  const activeProviderId =
    settings.activeProviderId &&
    providers.some((provider) => provider.id === settings.activeProviderId)
      ? settings.activeProviderId
      : providers[0]?.id || ''

  const normalizedProviders = providers.map(normalizeProviderModelCatalog)
  changed =
    changed ||
    normalizedProviders.some((provider, index) => {
      const original = providers[index]
      return (
        !original ||
        original.endpointType !== provider.endpointType ||
        JSON.stringify(original.models || {}) !== JSON.stringify(provider.models || {}) ||
        JSON.stringify(original.modelContextWindows || {}) !==
          JSON.stringify(provider.modelContextWindows || {})
      )
    })

  const nextSettings: AppSettings = {
    ...settings,
    providers: normalizedProviders,
    activeProviderId,
    providerPresetVersion: PROVIDER_PRESET_VERSION
  }

  return {
    settings: nextSettings,
    changed:
      changed ||
      activeProviderId !== settings.activeProviderId ||
      settings.providerPresetVersion !== PROVIDER_PRESET_VERSION
  }
}
