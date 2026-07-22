import type {
  ApiProvider,
  ModelFeatureSupport,
  ModelCompatibilityProfile,
  ModelInfo,
  ModelPromptProfile,
  ModelTransportId,
  ProviderApiFormat,
  ResolvedModelCompatibilityProfile,
  ResolvedModelFeatureSupport
} from './types'
import {
  getRegisteredProviderRuntimeProfile,
  PROVIDER_REGISTRATIONS,
  type ProviderRuntimeProfile
} from './providerRegistry'

export type { ProviderRuntimeProfile } from './providerRegistry'

/** Compatibility view derived from the single registration source. */
export const PROVIDER_RUNTIME_PROFILES = Object.fromEntries(
  PROVIDER_REGISTRATIONS.map((item) => [item.definition.type, item.runtime])
) as Record<ApiProvider['type'], ProviderRuntimeProfile>

export function getProviderRuntimeProfile(type: ApiProvider['type']): ProviderRuntimeProfile {
  return getRegisteredProviderRuntimeProfile(type)
}

export function apiFormatToTransportId(format: ProviderApiFormat): ModelTransportId {
  return format === 'responses' ? 'openai-responses' : 'openai-chat-completions'
}

export function transportIdToApiFormat(transportId: ModelTransportId): ProviderApiFormat {
  return transportId === 'openai-responses' ? 'responses' : 'chat-completions'
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

export function resolveModelCompatibility(
  provider: Pick<ApiProvider, 'type' | 'compatibility'>,
  model: Pick<ModelInfo, 'apiId' | 'id' | 'compatibility'>
): ResolvedModelCompatibilityProfile {
  const profile = getProviderRuntimeProfile(provider.type)
  const modelId = (model.apiId || model.id).trim().toLowerCase()
  const inferred = (profile.modelCompatibilityRules || [])
    .filter((rule) => rule.includes.some((part) => modelId.includes(part)))
    .reduce<ModelCompatibilityProfile>((result, rule) => ({ ...result, ...rule.compatibility }), {})

  return {
    ...profile.compatibility,
    ...(provider.compatibility || {}),
    ...inferred,
    ...(model.compatibility || {})
  }
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
