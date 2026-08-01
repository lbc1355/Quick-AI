import { describe, expect, it } from 'vitest'
import { getReasoningPreferenceKey } from './reasoningControl'
import { resolveSessionReasoningPreference } from './reasoningPreferenceResolution'

describe('resolveSessionReasoningPreference', () => {
  const effort = {
    mode: 'effort' as const,
    encoding: 'openai-effort' as const,
    levels: ['low', 'high'] as const
  }

  it('prefers session override over model defaults', () => {
    const key = getReasoningPreferenceKey('p1', 'm1')
    expect(
      resolveSessionReasoningPreference({
        session: { reasoningPreference: 'low' },
        providerId: 'p1',
        modelId: 'm1',
        reasoningDefaults: { [key]: 'high' },
        control: effort
      })
    ).toBe('low')
  })

  it('uses model defaults then auto', () => {
    const key = getReasoningPreferenceKey('p1', 'm1')
    expect(
      resolveSessionReasoningPreference({
        providerId: 'p1',
        modelId: 'm1',
        reasoningDefaults: { [key]: 'high' },
        control: effort
      })
    ).toBe('high')
    expect(
      resolveSessionReasoningPreference({
        providerId: 'p1',
        modelId: 'm1',
        control: effort
      })
    ).toBe('auto')
  })

  it('keeps two sessions independently resolvable', () => {
    const a = resolveSessionReasoningPreference({
      session: { reasoningPreference: 'low' },
      control: effort
    })
    const b = resolveSessionReasoningPreference({
      session: { reasoningPreference: 'high' },
      control: effort
    })
    expect(a).toBe('low')
    expect(b).toBe('high')
  })
})
