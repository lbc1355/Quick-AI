import { describe, it, expect } from 'vitest'
import { toFileUrl } from './fileOperationResult'

describe('toFileUrl', () => {
  it('percent-encodes spaces while keeping the Windows drive-colon', () => {
    expect(toFileUrl('C:\\my dir\\a b.png')).toBe('file:///C:/my%20dir/a%20b.png')
  })

  it('does not throw on emoji filenames (surrogate pairs)', () => {
    expect(() => toFileUrl('C:\\img\\😀.png')).not.toThrow()
    expect(toFileUrl('C:\\img\\😀.png')).toContain('%F0%9F%98%80')
  })

  it('encodes "#" so it cannot be parsed as a URL fragment', () => {
    expect(toFileUrl('C:\\a#b.txt')).toBe('file:///C:/a%23b.txt')
  })

  it('encodes POSIX-style absolute paths (drive resolution is platform-dependent)', () => {
    // On Windows `pathToFileURL('/tmp/x')` resolves to the current drive (e.g. file:///D:/tmp/x);
    // the encoding of the path itself is what we assert here.
    const url = toFileUrl('/tmp/a b.txt')
    expect(url.startsWith('file:///')).toBe(true)
    expect(url).toContain('/tmp/a%20b.txt')
  })
})
