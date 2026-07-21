import { normalizeProviderModelCatalog } from './modelCatalog'
import { getProviderRuntimeProfile } from './providerProfiles'
import type { ApiProvider, ProviderAuthType, ProviderType } from './types'

export interface ProviderRegistrationDefinition {
  type: ProviderType
  name: string
  models: readonly string[]
  defaultModel: string
}

export interface ProviderRegistrationAccountDefaults {
  apiUrl: string
  authType: ProviderAuthType
  authHeader?: string
  headers?: Readonly<Record<string, string>>
}

/**
 * Application-level provider registration. Static protocol/model metadata and mutable account
 * defaults are deliberately separate so credentials never become part of a provider definition.
 */
export interface ProviderRegistration {
  definition: ProviderRegistrationDefinition
  accountDefaults: ProviderRegistrationAccountDefaults
}

const registration = (
  definition: ProviderRegistrationDefinition,
  accountDefaults: ProviderRegistrationAccountDefaults
): ProviderRegistration => ({ definition, accountDefaults })

export const PROVIDER_REGISTRATIONS: readonly ProviderRegistration[] = [
  registration(
    {
      type: 'opencode',
      name: 'opencode',
      models: ['deepseek-v4-flash-free', 'deepseek-v4-pro', 'qwen3-coder-plus'],
      defaultModel: 'deepseek-v4-flash-free'
    },
    { apiUrl: 'https://opencode.ai/zen/v1', authType: 'bearer' }
  ),
  registration(
    {
      type: 'glm',
      name: 'GLM',
      models: ['glm-4.5-air', 'glm-4.5', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-4-flash'],
      defaultModel: 'glm-4.5-air'
    },
    { apiUrl: 'https://open.bigmodel.cn/api/paas/v4', authType: 'bearer' }
  ),
  registration(
    {
      type: 'kimi',
      name: 'Kimi',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
      defaultModel: 'moonshot-v1-8k'
    },
    { apiUrl: 'https://api.moonshot.cn/v1', authType: 'bearer' }
  ),
  registration(
    {
      type: 'mimo',
      name: 'MiMo',
      models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-flash'],
      defaultModel: 'mimo-v2.5-pro'
    },
    { apiUrl: 'https://api.mimo.xiaomi.com/v1', authType: 'bearer' }
  ),
  registration(
    {
      type: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      defaultModel: 'deepseek-chat'
    },
    { apiUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }
  ),
  registration(
    {
      type: 'ollama',
      name: 'Local Ollama',
      models: ['deepseek-r1:8b', 'llama3'],
      defaultModel: 'deepseek-r1:8b'
    },
    { apiUrl: 'http://localhost:11434/v1', authType: 'none' }
  ),
  registration(
    {
      type: 'step',
      name: '阶跃星辰',
      models: [
        'step-3.7-flash',
        'step-3.5-flash',
        'step-router-v1',
        'step-1-8k',
        'step-1-32k',
        'step-1-128k',
        'step-2-16k'
      ],
      defaultModel: 'step-3.7-flash'
    },
    { apiUrl: 'https://api.stepfun.com/step_plan/v1', authType: 'bearer' }
  ),
  registration(
    {
      type: 'custom',
      name: '自定义服务商',
      models: ['custom-model'],
      defaultModel: 'custom-model'
    },
    { apiUrl: '', authType: 'bearer' }
  )
]

export const CORE_PROVIDER_TYPES: readonly ProviderType[] = [
  'opencode',
  'glm',
  'kimi',
  'mimo',
  'step'
]

export function getProviderRegistration(type: ProviderType): ProviderRegistration | undefined {
  return PROVIDER_REGISTRATIONS.find((item) => item.definition.type === type)
}

export function getRegisteredProviderTypeLabel(type: ProviderType): string {
  return getProviderRegistration(type)?.definition.name || type
}

export function getRegisteredProviderAuthType(type: ProviderType): ProviderAuthType {
  return getProviderRegistration(type)?.accountDefaults.authType || 'bearer'
}

export function createProviderFromRegistration(
  item: ProviderRegistration,
  options: { id?: string; name?: string } = {}
): ApiProvider {
  const { definition, accountDefaults } = item
  const runtime = getProviderRuntimeProfile(definition.type)
  return normalizeProviderModelCatalog({
    id: options.id || `provider-${definition.type}`,
    name: options.name || definition.name,
    type: definition.type,
    apiKey: '',
    apiUrl: accountDefaults.apiUrl,
    authType: accountDefaults.authType,
    authHeader: accountDefaults.authHeader,
    headers: { ...(accountDefaults.headers || {}) },
    model: definition.defaultModel,
    modelsList: [...definition.models],
    endpointType: runtime.endpointType,
    transportId: runtime.transportId,
    apiFormat: runtime.apiFormat,
    features: { ...runtime.features },
    compatibility: { ...runtime.compatibility },
    promptProfile: runtime.promptProfile
  })
}
