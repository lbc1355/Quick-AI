import {
  ApiProvider,
  ModelFeatureSupport,
  ModelInfo,
  ModelPromptProfile,
  ProviderApiFormat,
  ProviderEndpointType,
  ResolvedModelFeatureSupport
} from './types'

export interface ProviderRuntimeProfile {
  endpointType: ProviderEndpointType
  apiFormat: ProviderApiFormat
  promptProfile: ModelPromptProfile
  features: ResolvedModelFeatureSupport
}

const OPENAI_COMPATIBLE_FEATURES: ResolvedModelFeatureSupport = {
  toolCalls: true,
  parallelToolCalls: true,
  reasoning: false,
  vision: false,
  promptCaching: false,
  streamUsage: true
}

const profile = (overrides: Partial<ProviderRuntimeProfile> = {}): ProviderRuntimeProfile => ({
  endpointType: 'openai-compatible',
  apiFormat: 'chat-completions',
  promptProfile: 'default',
  features: { ...OPENAI_COMPATIBLE_FEATURES },
  ...overrides,
  ...(overrides.features
    ? { features: { ...OPENAI_COMPATIBLE_FEATURES, ...overrides.features } }
    : {})
})

export const PROVIDER_RUNTIME_PROFILES: Record<ApiProvider['type'], ProviderRuntimeProfile> = {
  opencode: profile(),
  deepseek: profile(),
  kimi: profile(),
  glm: profile({ features: { ...OPENAI_COMPATIBLE_FEATURES, streamUsage: false } }),
  mimo: profile(),
  step: profile(),
  ollama: profile({
    endpointType: 'ollama-openai',
    features: {
      ...OPENAI_COMPATIBLE_FEATURES,
      parallelToolCalls: false,
      streamUsage: false
    }
  }),
  custom: profile({ endpointType: 'custom' })
}

export function getProviderRuntimeProfile(type: ApiProvider['type']): ProviderRuntimeProfile {
  return PROVIDER_RUNTIME_PROFILES[type] || PROVIDER_RUNTIME_PROFILES.custom
}

export function inferModelPromptProfile(
  modelId: string,
  fallback: ModelPromptProfile = 'default'
): ModelPromptProfile {
  const id = modelId.trim().toLowerCase()
  if (/claude/.test(id)) return 'claude'
  if (/gemini/.test(id)) return 'gemini'
  if (/(^|[/:_-])(gpt|o1|o3|o4)([/:_.-]|$)|codex/.test(id)) return 'gpt'
  if (/(deepseek[-_]?r1|reasoner|reasoning|qwq)/.test(id)) return 'reasoning'
  return fallback
}

const legacyCapabilityFeatures = (capabilities: ModelInfo['capabilities']): ModelFeatureSupport => {
  if (!capabilities || capabilities.length === 0) return {}
  return {
    toolCalls: capabilities.includes('tools'),
    reasoning: capabilities.includes('reasoning'),
    vision: capabilities.includes('vision')
  }
}

const inferredModelFeatures = (modelId: string): ModelFeatureSupport => {
  const id = modelId.trim().toLowerCase()
  return {
    ...(/(deepseek[-_]?r1|reasoner|reasoning|qwq|(^|[/:_-])o[134]([/:_.-]|$))/.test(id)
      ? { reasoning: true }
      : {}),
    ...(/(^|[/:_-])(vision|vl)([/:_.-]|$)|gpt-4o|gemini/.test(id) ? { vision: true } : {})
  }
}

export function resolveModelFeatureSupport(
  provider: Pick<ApiProvider, 'type' | 'features'>,
  model: Pick<ModelInfo, 'apiId' | 'id' | 'capabilities' | 'features'>
): ResolvedModelFeatureSupport {
  const defaults = getProviderRuntimeProfile(provider.type).features
  const resolved = {
    ...defaults,
    ...inferredModelFeatures(model.apiId || model.id),
    ...legacyCapabilityFeatures(model.capabilities),
    ...(provider.features || {}),
    ...(model.features || {})
  }
  if (!resolved.toolCalls) resolved.parallelToolCalls = false
  return resolved
}

export function resolveModelPromptProfile(
  provider: Pick<ApiProvider, 'type' | 'promptProfile'>,
  model: Pick<ModelInfo, 'apiId' | 'id' | 'promptProfile'>
): ModelPromptProfile {
  if (model.promptProfile) return model.promptProfile
  if (provider.promptProfile) return provider.promptProfile
  const fallback = getProviderRuntimeProfile(provider.type).promptProfile
  return inferModelPromptProfile(model.apiId || model.id, fallback)
}
