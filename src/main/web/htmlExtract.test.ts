import { describe, expect, it } from 'vitest'
import {
  extractMainContentHtml,
  renderWithLineNumbers,
  stripHtml,
  stripHtmlWithLinks
} from './htmlExtract'

describe('htmlExtract', () => {
  it('strips tags and decodes common entities', () => {
    expect(stripHtml('<p>Hello <b>World</b> &amp; friends</p>')).toBe('Hello World & friends')
  })

  it('inlines links with numeric references', () => {
    const result = stripHtmlWithLinks(
      '<p>Open <a href="/docs">Docs</a></p>',
      'https://example.test'
    )

    expect(result.text).toContain('[1] Docs')
    expect(result.links).toEqual([{ id: 1, text: 'Docs', href: 'https://example.test/docs' }])
  })

  it('extracts primary article content and renders line numbers', () => {
    const main = extractMainContentHtml(
      '<body><nav>nav links</nav><article><h1>Title</h1><p>Primary content with enough words to be treated as meaningful article text for extraction.</p></article></body>'
    )

    expect(stripHtml(main || '')).toContain('Primary content')
    expect(renderWithLineNumbers('a\nb', 3)).toBe('    3  a\n    4  b')
  })
})
