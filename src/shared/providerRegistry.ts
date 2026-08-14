import type {
  ModelCompatibilityProfile,
  ModelPromptProfile,
  ModelReasoningControl,
  ModelTransportId,
  ProviderApiFormat,
  ProviderAuthType,
  ProviderEndpointType,
  ProviderModelDiscoveryPolicy,
  ProviderType,
  ResolvedModelCompatibilityProfile,
  ResolvedModelFeatureSupport
} from './types'
import type { ModelReasoningRule } from './reasoningControl'

export interface ProviderRuntimeProfile {
  endpointType: ProviderEndpointType
  apiFormat: ProviderApiFormat
  transportId: ModelTransportId
  supportedTransports: readonly ModelTransportId[]
  promptProfile: ModelPromptProfile
  features: ResolvedModelFeatureSupport
  compatibility: ResolvedModelCompatibilityProfile
  modelCompatibilityRules?: readonly ModelCompatibilityRule[]
  defaultReasoningControl?: ModelReasoningControl
  modelReasoningRules?: readonly ModelReasoningRule[]
}

export interface ModelCompatibilityRule {
  includes: readonly string[]
  compatibility: ModelCompatibilityProfile
}

export type { ModelReasoningRule }

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
  preserveToolCallReasoningContent: false,
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

export function createProviderRuntimeProfile(
  overrides: ProviderRuntimeProfileOverrides = {}
): ProviderRuntimeProfile {
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

/** A complete provider registration with definition, connection defaults, and runtime policy. */
export interface ProviderRegistration {
  definition: ProviderRegistrationDefinition
  accountDefaults: ProviderRegistrationAccountDefaults
  runtime: ProviderRuntimeProfile
  modelDiscovery: ProviderModelDiscoveryPolicy
}

export function createProviderModelDiscoveryPolicy(
  overrides: Partial<ProviderModelDiscoveryPolicy> = {}
): ProviderModelDiscoveryPolicy {
  return {
    endpointPath: 'models',
    collectionPaths: ['data', 'models', 'data.models', '$'],
    idPaths: ['id', 'name', 'model'],
    displayNamePaths: ['displayName', 'display_name', 'label'],
    contextWindowPaths: [
      'context_length',
      'context_window',
      'contextWindow',
      'contextWindowTokens',
      'max_context_length',
      'max_context_tokens',
      'max_context_window',
      'max_input_tokens',
      'input_token_limit',
      'max_model_len',
      'max_sequence_length',
      'limit.context'
    ],
    capabilityPaths: ['capabilities', 'supported_capabilities', 'supported_features'],
    ...overrides
  }
}

const registration = (
  definition: ProviderRegistrationDefinition,
  accountDefaults: ProviderRegistrationAccountDefaults,
  runtime: ProviderRuntimeProfile = createProviderRuntimeProfile(),
  modelDiscovery: ProviderModelDiscoveryPolicy = createProviderModelDiscoveryPolicy()
): ProviderRegistration => ({ definition, accountDefaults, runtime, modelDiscovery })

export const PROVIDER_REGISTRATIONS: readonly ProviderRegistration[] = [
  registration(
    {
      type: 'opencode',
      name: 'opencode',
      models: ['deepseek-v4-flash-free', 'deepseek-v4-pro', 'qwen3-coder-plus'],
      defaultModel: 'deepseek-v4-flash-free'
    },
    { apiUrl: 'https://opencode.ai/zen/v1', authType: 'bearer' },
    createProviderRuntimeProfile({
      compatibility: STRICT_OPENAI_COMPATIBILITY,
      modelCompatibilityRules: [
        {
          includes: ['deepseek'],
          compatibility: { preserveToolCallReasoningContent: true }
        }
      ],
      modelReasoningRules: [
        {
          // OpenCode DeepSeek V4 metadata exposes effort high/max (plus a toggle). Prefer effort.
          includes: ['deepseek'],
          reasoningControl: {
            mode: 'effort',
            encoding: 'openai-effort',
            levels: ['high', 'max']
          }
        }
      ]
    })
  ),
  registration(
    {
      type: 'glm',
      name: 'GLM',
      models: ['glm-4.5-air', 'glm-4.5', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-4-flash'],
      defaultModel: 'glm-4.5-air'
    },
    { apiUrl: 'https://open.bigmodel.cn/api/paas/v4', authType: 'bearer' },
    createProviderRuntimeProfile({
      features: { streamUsage: false },
      compatibility: { ...STRICT_OPENAI_COMPATIBILITY, omitToolChoice: true }
    })
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
    { apiUrl: 'https://api.mimo.xiaomi.com/v1', authType: 'bearer' },
    createProviderRuntimeProfile({ compatibility: STRICT_OPENAI_COMPATIBILITY })
  ),
  registration(
    {
      type: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-v4-flash'
    },
    { apiUrl: 'https://api.deepseek.com/v1', authType: 'bearer' },
    createProviderRuntimeProfile({
      compatibility: { preserveToolCallReasoningContent: true },
      modelReasoningRules: [
        {
          // DeepSeek V4 has two distinct effort levels. Compatibility aliases such as low and
          // xhigh map onto these values and should not appear as duplicate UI choices.
          includes: ['deepseek-v4'],
          reasoningControl: {
            mode: 'effort',
            encoding: 'openai-effort',
            levels: ['high', 'max']
          }
        },
        {
          // Legacy deepseek-reasoner exposes only the thinking toggle.
          includes: ['reasoner', 'r1'],
          reasoningControl: {
            mode: 'toggle',
            encoding: 'deepseek-thinking-toggle',
            supportsOff: true
          }
        }
      ]
    })
  ),
  registration(
    {
      type: 'ollama',
      name: 'Local Ollama',
      models: ['deepseek-r1:8b', 'llama3'],
      defaultModel: 'deepseek-r1:8b'
    },
    { apiUrl: 'http://localhost:11434/v1', authType: 'none' },
    createProviderRuntimeProfile({
      endpointType: 'ollama-openai',
      features: { parallelToolCalls: false, streamUsage: false },
      compatibility: { omitToolChoice: true }
    })
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
    { apiUrl: 'https://api.stepfun.com/step_plan/v1', authType: 'bearer' },
    createProviderRuntimeProfile({
      compatibility: STRICT_OPENAI_COMPATIBILITY,
      modelCompatibilityRules: [
        {
          includes: ['flash', 'r-mini', 'reason', 'router'],
          compatibility: { reasoningFormat: 'deepseek-style' }
        }
      ]
    })
  ),
  registration(
    {
      type: 'custom',
      name: '自定义服务商',
      models: ['custom-model'],
      defaultModel: 'custom-model'
    },
    { apiUrl: '', authType: 'bearer' },
    createProviderRuntimeProfile({
      endpointType: 'custom',
      supportedTransports: ['openai-chat-completions', 'openai-responses']
    })
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

export function getRegisteredProviderRuntimeProfile(type: ProviderType): ProviderRuntimeProfile {
  return (
    getProviderRegistration(type)?.runtime ||
    getProviderRegistration('custom')?.runtime ||
    createProviderRuntimeProfile()
  )
}

/** Return structural registration errors for startup diagnostics and regression tests. */
export function validateProviderRegistrations(
  registrations: readonly ProviderRegistration[] = PROVIDER_REGISTRATIONS
): string[] {
  const errors: string[] = []
  const seenTypes = new Set<ProviderType>()

  for (const item of registrations) {
    const { definition, runtime, modelDiscovery } = item
    if (seenTypes.has(definition.type)) {
      errors.push(`Duplicate provider type: ${definition.type}`)
    }
    seenTypes.add(definition.type)
    if (!definition.models.includes(definition.defaultModel)) {
      errors.push(`${definition.type}: default model is not registered`)
    }
    if (!runtime.supportedTransports.includes(runtime.transportId)) {
      errors.push(`${definition.type}: default transport is not supported`)
    }
    const expectedFormat =
      runtime.transportId === 'openai-responses' ? 'responses' : 'chat-completions'
    if (runtime.apiFormat !== expectedFormat) {
      errors.push(`${definition.type}: API format does not match default transport`)
    }
    if (!runtime.features.toolCalls && runtime.features.parallelToolCalls) {
      errors.push(`${definition.type}: parallel tools require tool-call support`)
    }
    if (!modelDiscovery.endpointPath.trim()) {
      errors.push(`${definition.type}: model discovery endpoint is empty`)
    }
    if (modelDiscovery.collectionPaths.length === 0 || modelDiscovery.idPaths.length === 0) {
      errors.push(`${definition.type}: model discovery field paths are incomplete`)
    }
  }

  return errors
}
