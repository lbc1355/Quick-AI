import type {
  ApiProvider,
  ModelInfo,
  ModelReasoningControl,
  ReasoningLevel,
  ReasoningPreference,
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
  provider: Pick<ApiProvider, 'features' | 'defaultReasoningControl'>,
  model: Pick<ModelInfo, 'apiId' | 'id' | 'capabilities' | 'features' | 'reasoningControl'>,
  runtimeProfile?: ReasoningRuntimeProfileSlice,
  resolvedFeatures?: ResolvedModelFeatureSupport
): ModelReasoningControl | undefined {
  if (model.reasoningControl) return sanitizeControl(model.reasoningControl)

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

/** Parse provider `/models` reasoning_options payloads into a typed control. */
export function parseDiscoveredReasoningControl(value: unknown): ModelReasoningControl | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''

  if (type === 'toggle') {
    return {
      mode: 'toggle',
      encoding: 'deepseek-thinking-toggle',
      supportsOff: true
    }
  }

  if (type === 'effort') {
    const levels = normalizeLevelList(raw.values)
    if (levels.length === 0) return { mode: 'fixed' }
    return {
      mode: 'effort',
      encoding: 'openai-effort',
      levels
    }
  }

  if (type === 'budget_tokens' || type === 'budget') {
    const minBudget = asPositiveInt(raw.min)
    const maxBudget = asPositiveInt(raw.max)
    const levels = uniqueOrderedLevels(
      normalizeLevelList(raw.values).length > 0
        ? normalizeLevelList(raw.values)
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

  // Unknown structured payload: keep reasoning feature, treat as fixed.
  if (type || Object.keys(raw).length > 0) return { mode: 'fixed' }
  return undefined
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
