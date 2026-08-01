import { buildBudgetsFromRange, uniqueOrderedLevels } from './reasoningControl'
import type { ModelReasoningControl, ReasoningLevel } from './types'

export type ReasoningControlPresetId =
  | 'none'
  | 'fixed'
  | 'openai-effort'
  | 'openrouter-reasoning'
  | 'openrouter-budget'
  | 'qwen-enable-thinking'
  | 'deepseek-thinking-toggle'

export const DEFAULT_EFFORT_LEVELS: ReasoningLevel[] = ['low', 'medium', 'high']

export function getReasoningControlPresetId(
  control?: ModelReasoningControl
): ReasoningControlPresetId {
  if (!control) return 'none'
  if (control.mode === 'fixed') return 'fixed'
  if (control.mode === 'toggle') return control.encoding
  if (control.mode === 'effort') return control.encoding
  return 'openrouter-budget'
}

export function buildReasoningControlFromPreset(
  preset: ReasoningControlPresetId,
  levels: readonly ReasoningLevel[] = DEFAULT_EFFORT_LEVELS
): ModelReasoningControl | undefined {
  if (preset === 'none') return undefined
  if (preset === 'fixed') return { mode: 'fixed' }
  if (preset === 'qwen-enable-thinking') {
    return { mode: 'toggle', encoding: 'qwen-enable-thinking', supportsOff: true }
  }
  if (preset === 'deepseek-thinking-toggle') {
    return { mode: 'toggle', encoding: 'deepseek-thinking-toggle', supportsOff: true }
  }

  const ordered = uniqueOrderedLevels(levels)
  const effectiveLevels = ordered.length > 0 ? ordered : DEFAULT_EFFORT_LEVELS

  if (preset === 'openai-effort') {
    return { mode: 'effort', encoding: 'openai-effort', levels: effectiveLevels }
  }
  if (preset === 'openrouter-reasoning') {
    return { mode: 'effort', encoding: 'openrouter-reasoning', levels: effectiveLevels }
  }

  const budgets = buildBudgetsFromRange(effectiveLevels, 1024, 32768)
  return {
    mode: 'budget',
    encoding: 'openrouter-budget',
    levels: effectiveLevels,
    budgets,
    minBudget: 1024,
    maxBudget: 32768,
    supportsOff: false
  }
}

export function getReasoningControlPresetLevels(control?: ModelReasoningControl): ReasoningLevel[] {
  if (!control || control.mode === 'fixed' || control.mode === 'toggle') {
    return DEFAULT_EFFORT_LEVELS
  }
  const levels = uniqueOrderedLevels(control.levels)
  return levels.length > 0 ? levels : DEFAULT_EFFORT_LEVELS
}
