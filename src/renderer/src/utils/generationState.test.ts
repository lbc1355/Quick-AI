import { describe, expect, it } from 'vitest'
import { getSessionGenerationState } from './generationState'

describe('getSessionGenerationState', () => {
  it('marks the current session as generating when ids match', () => {
    expect(getSessionGenerationState(true, 's1', 's1')).toEqual({
      isCurrentSessionGenerating: true,
      isOtherSessionGenerating: false
    })
  })

  it('marks another session as generating when ids differ', () => {
    expect(getSessionGenerationState(true, 's1', 's2')).toEqual({
      isCurrentSessionGenerating: false,
      isOtherSessionGenerating: true
    })
  })

  it('does not mark any session when global generation is idle', () => {
    expect(getSessionGenerationState(false, 's1', 's1')).toEqual({
      isCurrentSessionGenerating: false,
      isOtherSessionGenerating: false
    })
  })
})
