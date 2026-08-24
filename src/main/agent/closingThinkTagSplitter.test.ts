import { describe, expect, it } from 'vitest'
import { ClosingThinkTagSplitter } from './closingThinkTagSplitter'

describe('ClosingThinkTagSplitter', () => {
  it('splits reasoning and final content around a closing-only tag', () => {
    const splitter = new ClosingThinkTagSplitter()

    expect(splitter.push('Work through it. </think>The answer')).toEqual({
      reasoning: 'Work through it. ',
      content: 'The answer'
    })
    expect(splitter.push(' is 42.')).toEqual({ content: ' is 42.' })
    expect(splitter.finish()).toEqual({})
  })

  it('recognizes a delimiter split across arbitrary chunks', () => {
    const splitter = new ClosingThinkTagSplitter()

    expect(splitter.push('Reasoning<')).toEqual({ reasoning: 'Reasoning' })
    expect(splitter.push('/thi')).toEqual({})
    expect(splitter.push('nk>Final')).toEqual({ content: 'Final' })
  })

  it('flushes an unclosed stream as reasoning for terminal fallback handling', () => {
    const splitter = new ClosingThinkTagSplitter()

    expect(splitter.push('Direct answer without a tag')).toEqual({
      reasoning: 'Direct answer without a tag'
    })
    expect(splitter.finish()).toEqual({})
  })
})
