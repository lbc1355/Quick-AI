import { describe, expect, it } from 'vitest'
import { getCommandPrefixes } from './autocompleteHelpers'

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
