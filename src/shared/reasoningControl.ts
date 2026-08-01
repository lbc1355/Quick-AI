import type {
  ApiProvider,
  ModelInfo,
  ModelReasoningControl,
  ProviderType,
  ReasoningLevel,
  ReasoningPreference,
  ReasoningRequestEncoding,
  ResolvedModelFeatureSupport
} from './types'

export interface ModelReasoningRule {
  includes: readonly string[]
  reasoningControl: ModelReasoningControl
}

export interface ReasoningRuntimeProfileSlice {
  defaultReasoningControl?: ModelReasoningControl
  modelReasoningRules?: readonly ModelReasoningRule[]
  features?: Pick<ResolvedModelFeatureSupport, 'reasoning'>
}

export interface ParseDiscoveredReasoningControlContext {
  providerType?: ProviderType
  modelId?: string
  preferredEffortEncoding?: Extract<
    ReasoningRequestEncoding,
    'openai-effort' | 'openrouter-reasoning'
  >
  preferredToggleEncoding?: Extract<
    ReasoningRequestEncoding,
    'qwen-enable-thinking' | 'deepseek-thinking-toggle'
  >
}

export const REASONING_LEVEL_ORDER = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const satisfies readonly ReasoningLevel[]

const LEVEL_SET = new Set<string>(REASONING_LEVEL_ORDER)

export function getReasoningPreferenceKey(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId])
}

export function normalizeReasoningPreference(value: unknown): ReasoningPreference {
  if (typeof value !== 'string') return 'auto'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'off' || normalized === 'on') return normalized
  if (LEVEL_SET.has(normalized)) return normalized as ReasoningLevel
  return 'auto'
}

export function getAvailableReasoningPreferences(
  control?: ModelReasoningControl
): ReasoningPreference[] {
  if (!control) return ['auto']
  if (control.mode === 'fixed') return ['auto']
  if (control.mode === 'toggle') {
    return control.supportsOff ? ['auto', 'off', 'on'] : ['auto', 'on']
  }
  const levels = uniqueOrderedLevels(control.levels)
  if (control.mode === 'budget' && control.supportsOff) {
    return ['auto', 'off', ...levels]
  }
  if (control.mode === 'effort' && control.offValue) {
    return ['auto', 'off', ...levels]
  }
  return ['auto', ...levels]
}

export function fitReasoningPreference(
  control: ModelReasoningControl | undefined,
  requested: ReasoningPreference
): ReasoningPreference {
  const normalized = normalizeReasoningPreference(requested)
  const available = getAvailableReasoningPreferences(control)
  if (available.includes(normalized)) return normalized
  if (normalized === 'auto' || normalized === 'off' || normalized === 'on') return 'auto'
  if (!control || control.mode === 'fixed' || control.mode === 'toggle') return 'auto'

  const levels = uniqueOrderedLevels(control.levels)
  if (levels.length === 0) return 'auto'
  const targetIndex = REASONING_LEVEL_ORDER.indexOf(normalized)
  if (targetIndex < 0) return 'auto'

  let best = levels[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const level of levels) {
    const distance = Math.abs(REASONING_LEVEL_ORDER.indexOf(level) - targetIndex)
    if (distance < bestDistance) {
      best = level
      bestDistance = distance
    }
  }
  return best
}

export function resolveEffectiveReasoningPreference(input: {
  control?: ModelReasoningControl
  sessionPreference?: unknown
  modelDefault?: unknown
}): ReasoningPreference {
  const requested = normalizeReasoningPreference(
    input.sessionPreference ?? input.modelDefault ?? 'auto'
  )
  return fitReasoningPreference(input.control, requested)
}

export function resolveModelReasoningControl(
  provider: Pick<ApiProvider, 'type' | 'features' | 'defaultReasoningControl'>,
  model: Pick<
    ModelInfo,
    | 'apiId'
    | 'id'
    | 'capabilities'
    | 'features'
    | 'reasoningControl'
    | 'discoveredReasoningControl'
    | 'reasoningControlOverride'
  >,
  runtimeProfile?: ReasoningRuntimeProfileSlice,
  resolvedFeatures?: ResolvedModelFeatureSupport
): ModelReasoningControl | undefined {
  if (model.reasoningControlOverride) {
    return sanitizeControl(model.reasoningControlOverride)
  }

  // Custom providers: explicit advanced protocol beats auto-discovered metadata.
  if (provider.type === 'custom' && provider.defaultReasoningControl) {
    return sanitizeControl(provider.defaultReasoningControl)
  }

  const discovered = model.discoveredReasoningControl || model.reasoningControl
  if (discovered) return sanitizeControl(discovered)

  const modelId = (model.apiId || model.id || '').toLowerCase()
  const matchedRule = runtimeProfile?.modelReasoningRules?.find((rule) =>
    rule.includes.some((token) => modelId.includes(token.toLowerCase()))
  )
  if (matchedRule?.reasoningControl) return sanitizeControl(matchedRule.reasoningControl)

  if (provider.defaultReasoningControl) return sanitizeControl(provider.defaultReasoningControl)
  if (runtimeProfile?.defaultReasoningControl) {
    return sanitizeControl(runtimeProfile.defaultReasoningControl)
  }

  const hasReasoning =
    resolvedFeatures?.reasoning === true ||
    model.features?.reasoning === true ||
    provider.features?.reasoning === true ||
    runtimeProfile?.features?.reasoning === true ||
    model.capabilities?.includes('reasoning') === true

  if (hasReasoning) return { mode: 'fixed' }
  return undefined
}

/**
 * Parse provider `/models` reasoning_options payloads into a typed control.
 * Supports a single object or OpenCode-style arrays. Priority: effort > budget > toggle.
 */
export function parseDiscoveredReasoningControl(
  value: unknown,
  context?: ParseDiscoveredReasoningControlContext
): ModelReasoningControl | undefined {
  const options = normalizeReasoningOptionList(value)
  if (options.length === 0) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { mode: 'fixed' }
    }
    return undefined
  }

  const effort = options.find((option) => option.type === 'effort')
  if (effort) {
    const levels = normalizeLevelList(effort.values)
    if (levels.length === 0) return { mode: 'fixed' }
    return {
      mode: 'effort',
      encoding: resolveEffortEncoding(context),
      levels
    }
  }

  const budget = options.find(
    (option) => option.type === 'budget_tokens' || option.type === 'budget'
  )
  if (budget) {
    const minBudget = asPositiveInt(budget.min)
    const maxBudget = asPositiveInt(budget.max)
    const levels = uniqueOrderedLevels(
      normalizeLevelList(budget.values).length > 0
        ? normalizeLevelList(budget.values)
        : (['low', 'medium', 'high'] as ReasoningLevel[])
    )
    const budgets = buildBudgetsFromRange(levels, minBudget, maxBudget)
    if (Object.keys(budgets).length === 0) return { mode: 'fixed' }
    return {
      mode: 'budget',
      encoding: 'openrouter-budget',
      levels,
      budgets,
      ...(minBudget !== undefined ? { minBudget } : {}),
      ...(maxBudget !== undefined ? { maxBudget } : {}),
      supportsOff: false
    }
  }

  const toggle = options.find((option) => option.type === 'toggle')
  if (toggle) {
    return {
      mode: 'toggle',
      encoding: resolveToggleEncoding(context),
      supportsOff: true
    }
  }

  // Unknown structured payload: keep reasoning feature, treat as fixed.
  return { mode: 'fixed' }
}

export function buildBudgetsFromRange(
  levels: readonly ReasoningLevel[],
  minBudget?: number,
  maxBudget?: number
): Partial<Record<ReasoningLevel, number>> {
  const ordered = uniqueOrderedLevels(levels)
  if (ordered.length === 0) return {}
  const min = minBudget && minBudget > 0 ? minBudget : 1024
  const max = maxBudget && maxBudget >= min ? maxBudget : min * Math.max(1, ordered.length)
  if (ordered.length === 1) return { [ordered[0]]: clamp(Math.round((min + max) / 2), min, max) }

  const budgets: Partial<Record<ReasoningLevel, number>> = {}
  for (let index = 0; index < ordered.length; index += 1) {
    const ratio = index / (ordered.length - 1)
    budgets[ordered[index]] = Math.round(min + (max - min) * ratio)
  }
  return budgets
}

export function uniqueOrderedLevels(levels: readonly string[] | undefined): ReasoningLevel[] {
  if (!levels || levels.length === 0) return []
  const present = new Set(
    levels
      .map((level) => level.trim().toLowerCase())
      .filter((level): level is ReasoningLevel => LEVEL_SET.has(level))
  )
  return REASONING_LEVEL_ORDER.filter((level) => present.has(level))
}

interface RawReasoningOption {
  type: string
  values?: unknown
  min?: unknown
  max?: unknown
}

function normalizeReasoningOptionList(value: unknown): RawReasoningOption[] {
  if (!value) return []
  const items = Array.isArray(value) ? value : [value]
  const options: RawReasoningOption[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''
    if (!type) continue
    options.push({
      type,
      values: raw.values,
      min: raw.min,
      max: raw.max
    })
  }
  return options
}

function resolveEffortEncoding(
  context?: ParseDiscoveredReasoningControlContext
): Extract<ReasoningRequestEncoding, 'openai-effort' | 'openrouter-reasoning'> {
  if (context?.preferredEffortEncoding) return context.preferredEffortEncoding
  // OpenAI-compatible (incl. OpenCode Zen / DeepSeek) use reasoning_effort unless a caller
  // opts into OpenRouter nesting via preferredEffortEncoding.
  return 'openai-effort'
}

function resolveToggleEncoding(
  context?: ParseDiscoveredReasoningControlContext
): Extract<ReasoningRequestEncoding, 'qwen-enable-thinking' | 'deepseek-thinking-toggle'> {
  if (context?.preferredToggleEncoding) return context.preferredToggleEncoding
  const modelId = (context?.modelId || '').toLowerCase()
  if (modelId.includes('qwen')) return 'qwen-enable-thinking'
  return 'deepseek-thinking-toggle'
}

function normalizeLevelList(value: unknown): ReasoningLevel[] {
  if (!Array.isArray(value)) return []
  return uniqueOrderedLevels(value.filter((item): item is string => typeof item === 'string'))
}

function sanitizeControl(control: ModelReasoningControl): ModelReasoningControl {
  if (control.mode === 'fixed') return { mode: 'fixed' }
  if (control.mode === 'toggle') {
    return {
      mode: 'toggle',
      encoding: control.encoding,
      supportsOff: control.supportsOff !== false
    }
  }
  if (control.mode === 'effort') {
    const levels = uniqueOrderedLevels(control.levels)
    return {
      mode: 'effort',
      encoding: control.encoding,
      levels: levels.length > 0 ? levels : ['low', 'medium', 'high'],
      ...(control.levelMap ? { levelMap: control.levelMap } : {}),
      ...(control.offValue ? { offValue: control.offValue } : {})
    }
  }
  const levels = uniqueOrderedLevels(control.levels)
  return {
    mode: 'budget',
    encoding: 'openrouter-budget',
    levels: levels.length > 0 ? levels : uniqueOrderedLevels(Object.keys(control.budgets || {})),
    budgets: { ...control.budgets },
    ...(control.minBudget !== undefined ? { minBudget: control.minBudget } : {}),
    ...(control.maxBudget !== undefined ? { maxBudget: control.maxBudget } : {}),
    ...(control.supportsOff !== undefined ? { supportsOff: control.supportsOff } : {})
  }
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
