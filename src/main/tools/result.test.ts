import { describe, expect, it } from 'vitest'
import { toWellFormedText } from '../../shared/unicodeText'
import {
  buildToolResultUiDetails,
  createRawToolResult,
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

  it('does not split emoji in tool summaries or details previews', () => {
    const result = createToolResult({
      resultForModel: `${'x'.repeat(218)}🌟end`,
      detailsLimit: 219
    })
    expect(result.resultForUi.summary).toBe(`${'x'.repeat(218)}…`)
    expect(result.resultForUi.details).toBe(toWellFormedText(result.resultForUi.details!))
  })

  it('creates model and UI results from mixed raw tool output', () => {
    const result = createRawToolResult({
      rawOutput: [
        { type: 'text', text: 'first line' },
        {
          type: 'resource',
          resource: {
            uri: 'file:///tmp/a.txt',
            text: 'resource body'
          }
        }
      ],
      title: 'External Tool',
      summary: 'Returned mixed content'
    })

    expect(result.resultForModel).toContain('first line')
    expect(result.resultForModel).toContain('"uri": "file:///tmp/a.txt"')
    expect(result.resultForUi.details).toContain('resource body')
  })
})
