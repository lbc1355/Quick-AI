import { describe, it, expect } from 'vitest'
import { pathEscapesWorkspace } from './pathPolicy'

describe('pathEscapesWorkspace', () => {
  it('treats in-workspace relative paths as safe', () => {
    expect(pathEscapesWorkspace('src/index.ts')).toBe(false)
    expect(pathEscapesWorkspace('./a/b/c.txt')).toBe(false)
    expect(pathEscapesWorkspace('a/../b/c.txt')).toBe(false) // dips to 0, not below
  })

  it('flags traversal that climbs above the root', () => {
    expect(pathEscapesWorkspace('../outside')).toBe(true)
    expect(pathEscapesWorkspace('a/../../b')).toBe(true)
  })

  it('does not confuse a literal name containing dots with traversal', () => {
    expect(pathEscapesWorkspace('foo..bar')).toBe(false)
    expect(pathEscapesWorkspace('weird..name/file.txt')).toBe(false)
  })

  it('flags absolute, home, and env-relative paths', () => {
    expect(pathEscapesWorkspace('/etc/passwd')).toBe(true)
    expect(pathEscapesWorkspace('C:/Windows/System32')).toBe(true)
    expect(pathEscapesWorkspace('~/secrets')).toBe(true)
    expect(pathEscapesWorkspace('$HOME/.ssh/id_rsa')).toBe(true)
  })

  it('handles backslash separators', () => {
    expect(pathEscapesWorkspace('..\\outside')).toBe(true)
    expect(pathEscapesWorkspace('sub\\dir\\file.txt')).toBe(false)
  })
})
