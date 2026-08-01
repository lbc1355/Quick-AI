import { normalizeContextWindowTokens } from './modelContext'
import { normalizeProviderModelCatalog } from './modelCatalog'
import { createProviderModelDiscoveryPolicy, getProviderRegistration } from './providerRegistry'
import {
  parseDiscoveredReasoningControl,
  type ParseDiscoveredReasoningControlContext
} from './reasoningControl'
import type {
  FetchedModelInfo,
  ApiProvider,
  ModelCapability,
  ModelReasoningControl,
  ProviderModelDiscoveryPolicy,
  ProviderType
} from './types'

export function mergeDiscoveredModelMetadata(
  provider: ApiProvider,
  discoveredModels: FetchedModelInfo[]
): ApiProvider {
  const normalized = normalizeProviderModelCatalog(provider)
  const discoveredById = new Map(discoveredModels.map((model) => [model.id, model]))
  return {
    ...normalized,
    models: Object.fromEntries(
      Object.entries(normalized.models || {}).map(([id, model]) => {
        const discovered = discoveredById.get(id)
        const capabilities = discovered?.capabilities || model.capabilities
        const discoveredReasoningControl =
          discovered?.discoveredReasoningControl ||
          discovered?.reasoningControl ||
          model.discoveredReasoningControl
        const withReasoningCapability =
          discoveredReasoningControl && (!capabilities || !capabilities.includes('reasoning'))
            ? [...(capabilities || []), 'reasoning' as const]
            : capabilities
        return [
          id,
          {
            ...model,
            displayName: discovered?.displayName || model.displayName,
            capabilities: withReasoningCapability,
            ...(discoveredReasoningControl ? { discoveredReasoningControl } : {}),
            ...(discoveredReasoningControl || withReasoningCapability?.includes('reasoning')
              ? {
                  features: {
                    ...(model.features || {}),
                    reasoning: true
                  }
                }
              : {})
          }
        ]
      })
    )
  }
}

export function getProviderModelDiscoveryPolicy(type: ProviderType): ProviderModelDiscoveryPolicy {
  return getProviderRegistration(type)?.modelDiscovery || createProviderModelDiscoveryPolicy()
}

export function resolveProviderModelDiscoveryUrl(type: ProviderType, baseUrl: string): string {
  const path = getProviderModelDiscoveryPolicy(type).endpointPath.trim()
  if (/^https?:\/\//i.test(path)) return path
  const base = baseUrl.trim().replace(/\/$/, '')
  if (!base) return ''
  return `${base}/${path.replace(/^\//, '')}`
}

export function normalizeProviderModelDiscoveryResponse(
  data: unknown,
  policy: ProviderModelDiscoveryPolicy,
  context?: ParseDiscoveredReasoningControlContext
): FetchedModelInfo[] {
  const collection = policy.collectionPaths
    .map((path) => readPath(data, path))
    .find((value): value is unknown[] => Array.isArray(value))
  if (!collection) return []

  const seen = new Set<string>()
  const result: FetchedModelInfo[] = []
  for (const item of collection) {
    const model = normalizeModel(item, policy, context)
    if (!model || seen.has(model.id)) continue
    seen.add(model.id)
    result.push(model)
  }
  return result
}

/** Build discovery parse context from the provider account/type and optional manual protocol. */
export function buildReasoningDiscoveryContext(
  providerType: ProviderType,
  defaultReasoningControl?: ModelReasoningControl
): ParseDiscoveredReasoningControlContext {
  const context: ParseDiscoveredReasoningControlContext = { providerType }
  if (defaultReasoningControl?.mode === 'effort') {
    context.preferredEffortEncoding = defaultReasoningControl.encoding
  }
  if (defaultReasoningControl?.mode === 'toggle') {
    context.preferredToggleEncoding = defaultReasoningControl.encoding
  }
  return context
}

function normalizeModel(
  item: unknown,
  policy: ProviderModelDiscoveryPolicy,
  context?: ParseDiscoveredReasoningControlContext
): FetchedModelInfo | undefined {
  if (typeof item === 'string') {
    const id = item.trim()
    return id ? { id } : undefined
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined

  const id = readFirstString(item, policy.idPaths)
  if (!id) return undefined
  const displayName = readFirstString(item, policy.displayNamePaths)
  const contextWindowTokens = policy.contextWindowPaths
    .map((path) => normalizeContextWindowTokens(readPath(item, path)))
    .find((value): value is number => value !== undefined)
  const capabilities = policy.capabilityPaths
    .map((path) => normalizeCapabilities(readPath(item, path)))
    .find((value) => value.length > 0)
  const parseContext: ParseDiscoveredReasoningControlContext = {
    ...context,
    modelId: id
  }
  const reasoningField = readPath(item, 'reasoning')
  const reasoningFlag = reasoningField === true
  // Only parse structured `reasoning` objects; boolean true is a capability flag, not a control.
  const discoveredReasoningControl =
    parseDiscoveredReasoningControl(readPath(item, 'reasoning_options'), parseContext) ||
    (!reasoningFlag && typeof reasoningField === 'object'
      ? parseDiscoveredReasoningControl(reasoningField, parseContext)
      : undefined)
  const mergedCapabilities = new Set(capabilities || [])
  if (discoveredReasoningControl || reasoningFlag) mergedCapabilities.add('reasoning')

  return {
    id,
    ...(displayName ? { displayName } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(mergedCapabilities.size > 0 ? { capabilities: [...mergedCapabilities] } : {}),
    ...(discoveredReasoningControl ? { discoveredReasoningControl } : {})
  }
}

function readPath(value: unknown, path: string): unknown {
  if (path === '$') return value
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

function readFirstString(value: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const candidate = readPath(value, path)
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim()
    if (normalized) return normalized
  }
  return undefined
}

function normalizeCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) return []
  const capabilities = new Set<ModelCapability>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim().toLowerCase()
    if (normalized === 'text') capabilities.add('text')
    if (['vision', 'image', 'images'].includes(normalized)) capabilities.add('vision')
    if (['tools', 'tool_calls', 'function_calling'].includes(normalized)) capabilities.add('tools')
    if (['reasoning', 'thinking'].includes(normalized)) capabilities.add('reasoning')
  }
  return [...capabilities]
}
