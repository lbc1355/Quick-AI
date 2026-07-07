import { describe, expect, it } from 'vitest'
import { parseStreamingMarkdownBlocks } from './streamingMarkdownPreview'

describe('parseStreamingMarkdownBlocks', () => {
  it('renders an unfinished fenced code block as a code block', () => {
    const blocks = parseStreamingMarkdownBlocks('before\n```ts\nconst value = 1')

    expect(blocks).toEqual([
      { type: 'text', text: 'before' },
      { type: 'code', lang: 'ts', code: 'const value = 1', closed: false }
    ])
  })

  it('renders a completed fenced code block as a code block', () => {
    const blocks = parseStreamingMarkdownBlocks('```js\nconsole.log(1)\n```\nafter')

    expect(blocks).toEqual([
      { type: 'code', lang: 'js', code: 'console.log(1)', closed: true },
      { type: 'text', text: 'after' }
    ])
  })

  it('renders a markdown table after the separator is available', () => {
    const blocks = parseStreamingMarkdownBlocks('| Name | Value |\n| --- | --- |\n| A | 1 |')

    expect(blocks).toEqual([
      {
        type: 'table',
        header: ['Name', 'Value'],
        rows: [['A', '1']]
      }
    ])
  })

  it('keeps an incomplete table header as plain text', () => {
    const blocks = parseStreamingMarkdownBlocks('| Name | Value |')

    expect(blocks).toEqual([{ type: 'text', text: '| Name | Value |' }])
  })
})
