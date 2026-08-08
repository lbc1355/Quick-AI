import { describe, expect, it } from 'vitest'
import { resolveDraftSubmissionAction } from './draftSubmissionPolicy'

describe('resolveDraftSubmissionAction', () => {
  it('uses normal send while the current session is idle', () => {
    expect(resolveDraftSubmissionAction(false)).toEqual({ type: 'send' })
  })

  it('ignores ordinary submit and steering while output is still streaming', () => {
    expect(resolveDraftSubmissionAction(true)).toEqual({ type: 'ignore' })
    expect(resolveDraftSubmissionAction(true, 'steer')).toEqual({ type: 'ignore' })
  })

  it('allows only the explicit queue action while output is still streaming', () => {
    expect(resolveDraftSubmissionAction(true, 'queue')).toEqual({
      type: 'admit',
      mode: 'queue'
    })
  })
})
