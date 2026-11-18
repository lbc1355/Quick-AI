import { describe, expect, it } from 'vitest'
import {
  extractMainContentHtml,
  renderWithLineNumbers,
  stripHtml,
  stripHtmlWithLinks
} from './htmlExtract'

describe('htmlExtract', () => {
  it('strips tags and decodes common entities', () => {
    expect(
      stripHtml(
        '<p>Hello <b>World</b> &amp; friends</p><script>steal()</script><style>.hidden{display:none}</style>'
      )
    ).toBe('Hello World & friends')
    expect(stripHtml('a &amp; b')).toBe('a & b')
    expect(stripHtml('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0')
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

  it('prefers <article>/<main> and drops nav/footer chrome', () => {
    const html = `
      <html><body>
        <nav><a href="/a">Home</a><a href="/b">About</a> menu menu menu</nav>
        <header>Site banner advertisement</header>
        <main>
          <article>
            <h1>The Real Title</h1>
            <p>This is the substantial primary article content that we want to keep. It is long enough to dominate the page and be recognized as the main region by the density heuristic.</p>
            <p>A second paragraph with more meaningful body text to ensure the article block clearly wins.</p>
          </article>
        </main>
        <footer>copyright nav links privacy terms contact</footer>
      </body></html>`
    const main = extractMainContentHtml(html)
    expect(main).not.toBeNull()
    const text = stripHtml(main as string)
    expect(text).toContain('The Real Title')
    expect(text).toContain('primary article content')
    expect(text).not.toContain('About')
    expect(text).not.toContain('copyright')
  })

  it('returns null when there is no confident main region', () => {
    const html = '<html><body><div>short</div><div>bits</div></body></html>'
    expect(extractMainContentHtml(html)).toBeNull()
  })
})
