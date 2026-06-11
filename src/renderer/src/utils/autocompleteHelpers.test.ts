import { describe, expect, it } from 'vitest'
import { getCommandPrefixes, getSegmentPrefixes, getPopupOptions } from './autocompleteHelpers'

describe('getCommandPrefixes', () => {
  it('returns empty array for empty command', () => {
    expect(getCommandPrefixes('')).toEqual([])
  })

  it('splits simple chained commands', () => {
    expect(getCommandPrefixes('cd "my dir" && git status')).toEqual(['cd', 'git', 'git status'])
  })

  it('filters out options starting with -', () => {
    expect(getCommandPrefixes('git commit -m "initial"')).toEqual(['git', 'git commit'])
  })

  it('extracts two-word prefixes when the second token is alphanumeric', () => {
    expect(getCommandPrefixes('git status')).toEqual(['git', 'git status'])
    expect(getCommandPrefixes('node app.js')).toEqual(['node'])
  })

  it('does not split semicolons inside quoted strings (e.g. Python inline code)', () => {
    const pythonCmd = `python -c "import os; files = os.listdir('outputs'); [print(f) for f in files]"`
    // Semicolons inside quotes should be ignored. The whole command is one segment.
    // The tokens are: ["python", "-c", "..."]
    // Since "-c" starts with "-", it is ignored for two-word prefix.
    // The only prefix should be "python".
    expect(getCommandPrefixes(pythonCmd)).toEqual(['python'])
  })

  it('handles mixed single and double quotes', () => {
    const cmd = `echo 'hello; world' && cd "dir; path"`
    expect(getCommandPrefixes(cmd)).toEqual(['echo', 'cd'])
  })
})

describe('getSegmentPrefixes', () => {
  it('returns one prefix per segment, deduplicated', () => {
    expect(getSegmentPrefixes('cd "x" && dir && type "y"')).toEqual(['cd', 'dir', 'type'])
  })

  it('returns single segment as-is', () => {
    expect(getSegmentPrefixes('git status')).toEqual(['git'])
  })

  it('handles empty command', () => {
    expect(getSegmentPrefixes('')).toEqual([])
  })
})

describe('getPopupOptions shell prefix collapsing', () => {
  it('collapses chained commands into one combined option', () => {
    const options = getPopupOptions({
      toolName: 'shell',
      args: { command: 'cd "x" && dir && type "y" && findstr "z"' }
    })
    const prefixOptions = options.filter(
      (o) => typeof o.payload === 'object' && o.payload.scope === 'prefix'
    )
    expect(prefixOptions).toHaveLength(1)
    const combined = prefixOptions[0]
    // @ts-expect-error - union narrowing is hard for tests
    const prefixes: string[] | undefined = combined.payload.prefixes
    expect(prefixes).toEqual(['cd', 'dir', 'type', 'findstr'])
    expect(combined.label).toContain('cd、dir、type、findstr')
  })

  it('keeps individual prefixes for a single-segment command', () => {
    const options = getPopupOptions({
      toolName: 'shell',
      args: { command: 'git status' }
    })
    const prefixOptions = options.filter(
      (o) => typeof o.payload === 'object' && o.payload.scope === 'prefix'
    )
    // Single segment → getCommandPrefixes returns ['git', 'git status']
    expect(prefixOptions).toHaveLength(2)
    expect(prefixOptions[0].label).toContain('git')
    expect(prefixOptions[1].label).toContain('git status')
  })

  it('returns fixed options for non-shell tools', () => {
    const options = getPopupOptions({
      toolName: 'fetch_url',
      args: { url: 'https://example.com' }
    })
    const prefixOptions = options.filter(
      (o) => typeof o.payload === 'object' && o.payload.scope === 'prefix'
    )
    expect(prefixOptions).toHaveLength(0)
  })
})
