import {
  ApiProvider,
  ModelFeatureSupport,
  ModelCompatibilityProfile,
  ModelInfo,
  ModelPromptProfile,
  ModelTransportId,
  ProviderApiFormat,
  ProviderEndpointType,
  ResolvedModelCompatibilityProfile,
  ResolvedModelFeatureSupport
} from './types'

export interface ProviderRuntimeProfile {
  endpointType: ProviderEndpointType
  apiFormat: ProviderApiFormat
  transportId: ModelTransportId
  supportedTransports: readonly ModelTransportId[]
  promptProfile: ModelPromptProfile
  features: ResolvedModelFeatureSupport
  compatibility: ResolvedModelCompatibilityProfile
  modelCompatibilityRules?: readonly ModelCompatibilityRule[]
}

interface ModelCompatibilityRule {
  includes: readonly string[]
  compatibility: ModelCompatibilityProfile
}

type ProviderRuntimeProfileOverrides = Omit<
  Partial<ProviderRuntimeProfile>,
  'features' | 'compatibility'
> & {
  features?: Partial<ResolvedModelFeatureSupport>
  compatibility?: ModelCompatibilityProfile
}

const OPENAI_COMPATIBLE_FEATURES: ResolvedModelFeatureSupport = {
  toolCalls: true,
  parallelToolCalls: true,
  reasoning: false,
  vision: false,
  promptCaching: false,
  streamUsage: true
}

const OPENAI_COMPATIBLE_COMPATIBILITY: ResolvedModelCompatibilityProfile = {
  stripReasoningContent: true,
  stripToolMessageName: false,
  normalizeToolCallContent: false,
  stripEmptyToolCalls: false,
  omitToolChoice: false
}

const STRICT_OPENAI_COMPATIBILITY: ResolvedModelCompatibilityProfile = {
  ...OPENAI_COMPATIBLE_COMPATIBILITY,
  stripToolMessageName: true,
  normalizeToolCallContent: true,
  stripEmptyToolCalls: true
}

const profile = (overrides: ProviderRuntimeProfileOverrides = {}): ProviderRuntimeProfile => {
  const { features, compatibility, ...rest } = overrides
  return {
    endpointType: 'openai-compatible',
    apiFormat: 'chat-completions',
    transportId: 'openai-chat-completions',
    supportedTransports: ['openai-chat-completions'],
    promptProfile: 'default',
    ...rest,
    features: { ...OPENAI_COMPATIBLE_FEATURES, ...(features || {}) },
    compatibility: { ...OPENAI_COMPATIBLE_COMPATIBILITY, ...(compatibility || {}) }
  }
}

export const PROVIDER_RUNTIME_PROFILES: Record<ApiProvider['type'], ProviderRuntimeProfile> = {
  opencode: profile({ compatibility: STRICT_OPENAI_COMPATIBILITY }),
  deepseek: profile(),
  kimi: profile(),
  glm: profile({
    features: { ...OPENAI_COMPATIBLE_FEATURES, streamUsage: false },
    compatibility: { ...STRICT_OPENAI_COMPATIBILITY, omitToolChoice: true }
  }),
  mimo: profile({ compatibility: STRICT_OPENAI_COMPATIBILITY }),
  step: profile({
    compatibility: STRICT_OPENAI_COMPATIBILITY,
    modelCompatibilityRules: [
      {
        includes: ['flash', 'r-mini', 'reason', 'router'],
        compatibility: { reasoningFormat: 'deepseek-style' }
      }
    ]
  }),
  ollama: profile({
    endpointType: 'ollama-openai',
    features: {
      ...OPENAI_COMPATIBLE_FEATURES,
      parallelToolCalls: false,
      streamUsage: false
    },
    compatibility: { omitToolChoice: true }
  }),
  custom: profile({
    endpointType: 'custom',
    supportedTransports: ['openai-chat-completions', 'openai-responses']
  })
}

export function getProviderRuntimeProfile(type: ApiProvider['type']): ProviderRuntimeProfile {
  return PROVIDER_RUNTIME_PROFILES[type] || PROVIDER_RUNTIME_PROFILES.custom
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
    ...OPENAI_COMPATIBLE_COMPATIBILITY,
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
