import { describe, it, expect } from 'vitest'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  isSensitiveDirectoryForRoot,
  isSensitiveFileName,
  pathEscapesWorkspace
} from './pathPolicy'

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

describe('isSensitiveFileName', () => {
  it('blocks dotenv, private keys, and cert material', () => {
    expect(isSensitiveFileName('.env')).toBe(true)
    expect(isSensitiveFileName('config/.env.local')).toBe(true)
    expect(isSensitiveFileName('id_rsa')).toBe(true)
    expect(isSensitiveFileName('sub/id_ed25519')).toBe(true)
    expect(isSensitiveFileName('cert.pem')).toBe(true)
    expect(isSensitiveFileName('client.pfx')).toBe(true)
  })

  it('blocks credential stores and package registry auth files', () => {
    expect(isSensitiveFileName('.npmrc')).toBe(true)
    expect(isSensitiveFileName('.pypirc')).toBe(true)
    expect(isSensitiveFileName('.netrc')).toBe(true)
    expect(isSensitiveFileName('.git-credentials')).toBe(true)
    expect(isSensitiveFileName('.dockercfg')).toBe(true)
    expect(isSensitiveFileName('credentials.json')).toBe(true)
    expect(isSensitiveFileName('deploy/secrets.json')).toBe(true)
  })

  it('blocks files under well-known secret directories', () => {
    expect(isSensitiveFileName('C:/Users/me/.ssh/config')).toBe(true)
    expect(isSensitiveFileName('C:/Users/me/.aws/credentials')).toBe(true)
    expect(isSensitiveFileName('/home/me/.kube/config')).toBe(true)
    expect(isSensitiveFileName('/home/me/.docker/config.json')).toBe(true)
    expect(isSensitiveFileName('/home/me/.config/git/credentials')).toBe(true)
  })

  it('allows ordinary files, even inside a same-named sibling dir', () => {
    expect(isSensitiveFileName('a.txt')).toBe(false)
    expect(isSensitiveFileName('src/c.ts')).toBe(false)
    expect(isSensitiveFileName('package.json')).toBe(false)
    expect(isSensitiveFileName('settings.json')).toBe(false)
    expect(isSensitiveFileName('config.json')).toBe(false)
    // An ".aws" sibling with a non-credential basename is not sensitive.
    expect(isSensitiveFileName('/home/me/.aws/region.json')).toBe(false)
  })

  it('handles empty input', () => {
    expect(isSensitiveFileName('')).toBe(false)
  })
})

describe('isSensitiveDirectoryForRoot', () => {
  it('refuses the home directory itself and its secret subdirectories', () => {
    expect(isSensitiveDirectoryForRoot(homedir())).toBe(true)
    expect(isSensitiveDirectoryForRoot(join(homedir(), '.ssh'))).toBe(true)
    expect(isSensitiveDirectoryForRoot(join(homedir(), '.config'))).toBe(true)
    expect(isSensitiveDirectoryForRoot(join(homedir(), '.aws'))).toBe(true)
  })

  it('allows ordinary project directories under the home folder', () => {
    expect(isSensitiveDirectoryForRoot(join(homedir(), 'projects', 'my-app'))).toBe(false)
    expect(isSensitiveDirectoryForRoot(join(homedir(), 'Documents'))).toBe(false)
  })

  it('refuses OS system zones present on this platform', () => {
    if (process.platform === 'win32') {
      expect(isSensitiveDirectoryForRoot('C:\\Windows\\System32')).toBe(true)
      expect(isSensitiveDirectoryForRoot('C:\\Program Files\\SomeApp')).toBe(true)
    } else {
      expect(isSensitiveDirectoryForRoot('/etc')).toBe(true)
      expect(isSensitiveDirectoryForRoot('/usr/local')).toBe(true)
    }
  })

  it('does not block scratch/temp-style directories', () => {
    expect(isSensitiveDirectoryForRoot(join(tmpdir(), 'my-scratch'))).toBe(false)
  })

  it('protects Windows system dirs from their env vars even off the C: drive', () => {
    if (process.platform !== 'win32') return
    const original = {
      SystemRoot: process.env.SystemRoot,
      ProgramFiles: process.env.ProgramFiles,
      ProgramData: process.env.ProgramData
    }
    try {
      process.env.SystemRoot = 'D:\\Windows'
      process.env.ProgramFiles = 'D:\\Program Files'
      process.env.ProgramData = 'D:\\ProgramData'
      expect(isSensitiveDirectoryForRoot('D:\\Windows\\System32')).toBe(true)
      expect(isSensitiveDirectoryForRoot('D:\\Program Files\\SomeApp')).toBe(true)
      expect(isSensitiveDirectoryForRoot('D:\\ProgramData\\x')).toBe(true)
      expect(isSensitiveDirectoryForRoot('D:\\projects\\my-app')).toBe(false)
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value !== undefined) process.env[key] = value
        else delete process.env[key]
      }
    }
  })
})
