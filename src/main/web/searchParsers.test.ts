import { describe, expect, it } from 'vitest'
import {
  formatSearchResultsForModel,
  parseBingResults,
  parseDuckDuckGoResults,
  parseSogouResults
} from './searchParsers'

describe('parseDuckDuckGoResults', () => {
  const html = `
    <div class="serp__results">
      <div class="result__body web-result extra">
        <h2><a rel="noopener" class="result__a js-result" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=abc">First <b>Title</b></a></h2>
        <a class="result__snippet" href="#">Snippet one &amp; more</a>
      </div>
      <div class="result__body web-result">
        <h2><a class="result__a" href="https://example.org/page2">Second Title</a></h2>
        <a class="result__snippet">Snippet two</a>
      </div>
    </div>`

  it('extracts titles, redirect URLs and snippets across blocks and formats model results', () => {
    const results = parseDuckDuckGoResults(html)
    expect(results).toEqual([
      {
        title: 'First Title',
        url: 'https://example.com/page1',
        snippet: 'Snippet one & more',
        source: 'DuckDuckGo'
      },
      {
        title: 'Second Title',
        url: 'https://example.org/page2',
        snippet: 'Snippet two',
        source: 'DuckDuckGo'
      }
    ])
    expect(formatSearchResultsForModel(results)).toBe(
      '1. First Title\n   URL: https://example.com/page1\n   Snippet: Snippet one & more\n\n' +
        '2. Second Title\n   URL: https://example.org/page2\n   Snippet: Snippet two'
    )
  })

  it('is resilient to attribute ordering on the anchor tag', () => {
    const reordered = `
      <div class="web-result">
        <a data-foo="bar" href="https://x.test/p" class="extra result__a">Reordered</a>
      </div>`
    const results = parseDuckDuckGoResults(reordered)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://x.test/p')
    expect(results[0].title).toBe('Reordered')
    expect(results[0].source).toBe('DuckDuckGo')
  })

  it('returns an empty array when the markup matches nothing', () => {
    expect(parseDuckDuckGoResults('<html><body>no results</body></html>')).toEqual([])
  })
})

describe('parseBingResults', () => {
  it('extracts multiple b_algo blocks, strips title tags and decodes snippet entities', () => {
    const html = `
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://bing1.test/x">Bing <b>One</b></a></h2>
        <div class="b_caption"><p>Caption one &amp; details</p></div>
      </li>
      <li class="b_algo b_ad">
        <h2><a target="_blank" href="https://bing2.test/y">Bing Two</a></h2>
        <p>Direct para two</p>
      </li>
    </ol>`

    expect(parseBingResults(html)).toEqual([
      {
        title: 'Bing One',
        url: 'https://bing1.test/x',
        snippet: 'Caption one & details',
        source: 'Bing'
      },
      {
        title: 'Bing Two',
        url: 'https://bing2.test/y',
        snippet: 'Direct para two',
        source: 'Bing'
      }
    ])
  })
})

describe('parseSogouResults', () => {
  it('resolves relative redirects against sogou.com and preserves absolute URLs', () => {
    const html = `
    <div class="results">
      <div class="vrwrap">
        <h3 class="vr-title"><a href="/link?url=hedJjaC291Abc">Sogou <em>One</em></a></h3>
        <div class="str_info">Snippet one here</div>
      </div>
      <div class="vrwrap">
        <h3><a href="https://direct.test/z">Sogou Two</a></h3>
      </div>
    </div>`

    const results = parseSogouResults(html)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Sogou One')
    expect(results[0].url).toBe('https://www.sogou.com/link?url=hedJjaC291Abc')
    expect(results[0].snippet).toBe('Snippet one here')
    expect(results[0].source).toBe('Sogou')
    expect(results[1].url).toBe('https://direct.test/z')
    expect(results[1].source).toBe('Sogou')
  })

  it('returns an empty array for non-matching markup', () => {
    expect(parseSogouResults('<div>nothing</div>')).toEqual([])
  })
})
