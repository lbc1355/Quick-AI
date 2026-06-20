import { describe, expect, it } from 'vitest'
import {
  buildToolResultUiDetails,
  createToolResult,
  normalizeToolExecutionResult
} from './result'

describe('tool result helpers', () => {
  it('creates model and UI results with details by default', () => {
    const result = createToolResult({
      resultForModel: 'Full tool output',
      title: 'Read File',
      summary: 'Read one file'
    })

    expect(result.resultForModel).toBe('Full tool output')
    expect(result.resultForUi).toMatchObject({
      title: 'Read File',
      summary: 'Read one file',
      details: 'Full tool output'
    })
  })

  it('normalizes legacy tool results that only contain summary UI metadata', () => {
    const result = normalizeToolExecutionResult(
      {
        resultForModel: 'Complete legacy output',
        resultForUi: {
          title: 'Legacy Tool',
          summary: 'Short summary'
        }
      },
      'call-1'
    )

    expect(result.resultForUi.details).toBe('Complete legacy output')
  })

  it('truncates oversized UI details with a retrievable call id', () => {
    const details = buildToolResultUiDetails('abcdef', { callId: 'call-2', limit: 3 })

    expect(details).toContain('abc')
    expect(details).toContain('call-2')
    expect(details.length).toBeGreaterThan(3)
  })
})
