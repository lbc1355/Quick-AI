import { describe, expect, it } from 'vitest'
import {
  fitReasoningPreference,
  getAvailableReasoningPreferences,
  getReasoningPreferenceKey,
  normalizeReasoningPreference,
  parseDiscoveredReasoningControl,
  resolveEffectiveReasoningPreference,
  resolveModelReasoningControl
} from './reasoningControl'
import type { ModelReasoningControl } from './types'

describe('reasoningControl', () => {
  it('keeps auto forever when normalizing and fitting', () => {
    expect(normalizeReasoningPreference('auto')).toBe('auto')
    expect(normalizeReasoningPreference('AUTO')).toBe('auto')
    expect(normalizeReasoningPreference(undefined)).toBe('auto')
    expect(normalizeReasoningPreference('mystery')).toBe('auto')
    expect(fitReasoningPreference({ mode: 'fixed' }, 'auto')).toBe('auto')
    expect(fitReasoningPreference(undefined, 'high')).toBe('auto')
  })

  it('fixed models only expose auto', () => {
    expect(getAvailableReasoningPreferences({ mode: 'fixed' })).toEqual(['auto'])
    expect(getAvailableReasoningPreferences(undefined)).toEqual(['auto'])
  })

  it('toggle models expose auto/off/on only when off is supported', () => {
    expect(
      getAvailableReasoningPreferences({
        mode: 'toggle',
        encoding: 'deepseek-thinking-toggle',
        supportsOff: true
      })
    ).toEqual(['auto', 'off', 'on'])
    expect(
      getAvailableReasoningPreferences({
        mode: 'toggle',
        encoding: 'qwen-enable-thinking',
        supportsOff: false
      })
    ).toEqual(['auto', 'on'])
  })

  it('effort models only return declared levels', () => {
    const control: ModelReasoningControl = {
      mode: 'effort',
      encoding: 'openai-effort',
      levels: ['high', 'low', 'high', 'xhigh']
    }
    expect(getAvailableReasoningPreferences(control)).toEqual(['auto', 'low', 'high', 'xhigh'])
  })

  it('picks the nearest supported level when switching models', () => {
    const control: ModelReasoningControl = {
      mode: 'effort',
      encoding: 'openai-effort',
      levels: ['low', 'high']
    }
    expect(fitReasoningPreference(control, 'medium')).toBe('low')
    expect(fitReasoningPreference(control, 'xhigh')).toBe('high')
    expect(fitReasoningPreference(control, 'minimal')).toBe('low')
    expect(fitReasoningPreference({ mode: 'fixed' }, 'high')).toBe('auto')
  })

  it('falls unknown persisted values back to auto', () => {
    expect(resolveEffectiveReasoningPreference({ sessionPreference: 'nope' })).toBe('auto')
    expect(
      resolveEffectiveReasoningPreference({
        control: {
          mode: 'effort',
          encoding: 'openai-effort',
          levels: ['medium']
        },
        sessionPreference: 'banana',
        modelDefault: 'high'
      })
    ).toBe('auto')
    expect(
      resolveEffectiveReasoningPreference({
        control: {
          mode: 'effort',
          encoding: 'openai-effort',
          levels: ['medium']
        },
        modelDefault: 'high'
      })
    ).toBe('medium')
  })

  it('builds stable preference keys', () => {
    expect(getReasoningPreferenceKey('p1', 'm1')).toBe(JSON.stringify(['p1', 'm1']))
  })

  it('parses discovery metadata without inventing effort for toggle/unknown', () => {
    expect(parseDiscoveredReasoningControl({ type: 'toggle' })).toEqual({
      mode: 'toggle',
      encoding: 'deepseek-thinking-toggle',
      supportsOff: true
    })
    expect(
      parseDiscoveredReasoningControl({ type: 'effort', values: ['low', 'medium', 'high'] })
    ).toEqual({
      mode: 'effort',
      encoding: 'openai-effort',
      levels: ['low', 'medium', 'high']
    })
    expect(
      parseDiscoveredReasoningControl({ type: 'budget_tokens', min: 1024, max: 8192 })
    ).toMatchObject({
      mode: 'budget',
      encoding: 'openrouter-budget',
      levels: ['low', 'medium', 'high'],
      minBudget: 1024,
      maxBudget: 8192
    })
    expect(parseDiscoveredReasoningControl({ type: 'mystery' })).toEqual({ mode: 'fixed' })
    expect(parseDiscoveredReasoningControl(null)).toBeUndefined()
  })

  it('resolves control precedence and fixed fallback', () => {
    expect(
      resolveModelReasoningControl(
        { features: { reasoning: true } },
        {
          id: 'm',
          apiId: 'm',
          capabilities: ['reasoning'],
          reasoningControl: {
            mode: 'effort',
            encoding: 'openai-effort',
            levels: ['low']
          }
        }
      )
    ).toEqual({
      mode: 'effort',
      encoding: 'openai-effort',
      levels: ['low']
    })

    expect(
      resolveModelReasoningControl(
        { features: {} },
        { id: 'deepseek-reasoner', apiId: 'deepseek-reasoner' },
        {
          modelReasoningRules: [
            {
              includes: ['reasoner'],
              reasoningControl: {
                mode: 'toggle',
                encoding: 'deepseek-thinking-toggle',
                supportsOff: true
              }
            }
          ]
        }
      )
    ).toEqual({
      mode: 'toggle',
      encoding: 'deepseek-thinking-toggle',
      supportsOff: true
    })

    expect(
      resolveModelReasoningControl(
        { features: { reasoning: true } },
        { id: 'opaque', apiId: 'opaque', capabilities: ['reasoning'] }
      )
    ).toEqual({ mode: 'fixed' })

    expect(
      resolveModelReasoningControl({ features: {} }, { id: 'plain', apiId: 'plain' })
    ).toBeUndefined()
  })
})
