import { describe, expect, it } from 'vitest'
import {
  formatSearchResultsForModel,
  parseBingResults,
  parseDuckDuckGoResults
} from './searchParsers'

describe('searchParsers', () => {
  it('parses Bing result blocks', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.test/a">Example <b>A</b></a></h2>
        <p>Snippet &amp; details</p>
      </li>`

    expect(parseBingResults(html)).toEqual([
      {
        title: 'Example A',
        url: 'https://example.test/a',
        snippet: 'Snippet & details',
        source: 'Bing'
      }
    ])
  })

  it('parses DuckDuckGo redirect URLs and formats results for the model', () => {
    const html = `
      <div class="web-result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Fb">Duck</a>
        <a class="result__snippet">Duck snippet</a>
      </div>`

    const results = parseDuckDuckGoResults(html)
    expect(results[0].url).toBe('https://example.test/b')
    expect(formatSearchResultsForModel(results)).toContain('Duck')
  })
})
