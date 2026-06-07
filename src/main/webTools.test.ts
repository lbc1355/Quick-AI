import { describe, it, expect } from 'vitest'
import {
  stripHtml,
  isPrivateIPv4,
  isPrivateIPv6,
  parseDuckDuckGoResults,
  parseBingResults,
  parseSogouResults,
  normalizeFetchUrlOptions
} from './webTools'

describe('stripHtml', () => {
  it('removes script/style content and surrounding tags', () => {
    const out = stripHtml('<p>Hello <b>World</b></p><script>steal()</script>')
    expect(out).toContain('Hello World')
    expect(out).not.toContain('steal')
  })

  it('decodes common HTML entities', () => {
    expect(stripHtml('a &amp; b')).toBe('a & b')
    expect(stripHtml('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0')
  })
})

describe('normalizeFetchUrlOptions', () => {
  it('defaults to the first fetch window', () => {
    expect(normalizeFetchUrlOptions()).toEqual({ offset: 0, maxChars: 10000 })
  })

  it('clamps offset and maxChars to safe page-window bounds', () => {
    expect(normalizeFetchUrlOptions({ offset: -50, maxChars: 100 })).toEqual({
      offset: 0,
      maxChars: 1000
    })
    expect(normalizeFetchUrlOptions({ offset: 42.9, maxChars: 25000 })).toEqual({
      offset: 42,
      maxChars: 16000
    })
  })
})

describe('isPrivateIPv4 (SSRF guard)', () => {
  it('flags private / reserved ranges', () => {
    for (const ip of [
      '10.0.0.1',
      '192.168.1.10',
      '127.0.0.1',
      '172.16.5.4',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0'
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIPv4(ip)).toBe(false)
    }
  })

  it('treats malformed input as private (fail closed)', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true)
    expect(isPrivateIPv4('1.2.3')).toBe(true)
  })
})

describe('isPrivateIPv6 (SSRF guard)', () => {
  it('flags loopback and unique-local / link-local ranges', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIPv6(ip)).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false)
  })
})

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

  it('extracts title, decoded redirect href, and snippet across blocks', () => {
    const results = parseDuckDuckGoResults(html)
    expect(results).toHaveLength(2)

    expect(results[0]).toEqual({
      title: 'First Title',
      url: 'https://example.com/page1',
      snippet: 'Snippet one & more',
      source: 'DuckDuckGo'
    })
    expect(results[1]).toEqual({
      title: 'Second Title',
      url: 'https://example.org/page2',
      snippet: 'Snippet two',
      source: 'DuckDuckGo'
    })
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
  const html = `
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://bing1.test/x">Bing One</a></h2>
        <div class="b_caption"><p>Caption one</p></div>
      </li>
      <li class="b_algo b_ad">
        <h2><a target="_blank" href="https://bing2.test/y">Bing Two</a></h2>
        <p>Direct para two</p>
      </li>
    </ol>`

  it('extracts results from b_algo blocks', () => {
    const results = parseBingResults(html)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'Bing One',
      url: 'https://bing1.test/x',
      snippet: 'Caption one',
      source: 'Bing'
    })
    expect(results[1]).toEqual({
      title: 'Bing Two',
      url: 'https://bing2.test/y',
      snippet: 'Direct para two',
      source: 'Bing'
    })
  })
})

describe('parseSogouResults', () => {
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

  it('resolves redirect-wrapped relative hrefs against sogou.com', () => {
    const results = parseSogouResults(html)
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Sogou One')
    expect(results[0].url).toBe('https://www.sogou.com/link?url=hedJjaC291Abc')
    expect(results[0].snippet).toBe('Snippet one here')
    expect(results[0].source).toBe('Sogou')
  })

  it('keeps absolute hrefs untouched', () => {
    const results = parseSogouResults(html)
    expect(results[1].url).toBe('https://direct.test/z')
    expect(results[1].source).toBe('Sogou')
  })

  it('returns an empty array for non-matching markup', () => {
    expect(parseSogouResults('<div>nothing</div>')).toEqual([])
  })
})
