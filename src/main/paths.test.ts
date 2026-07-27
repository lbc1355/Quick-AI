import { it, expect, describe, beforeEach, afterEach, vi } from 'vitest'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import {
  getQuickAiRoot,
  getMemoriesRoot,
  getSkillRoot,
  getWorkspaceRoot,
  readEnvPathOverride
} from './paths'

// Keep the real home directory out of reach: the fallback branch of getQuickAiRoot() calls
// ensureDir(), which would otherwise mkdir ~/.quickai on whatever machine runs the suite.
const fakeHome = join(tmpdir(), 'quickai-paths-test-home')
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => join(actual.tmpdir(), 'quickai-paths-test-home') }
})

/** getQuickAiRoot() returns realpathSync.native(), which expands Windows 8.3 short paths. */
const canonical = (path: string): string => {
  const absolute = resolve(path)
  mkdirSync(absolute, { recursive: true })
  return realpathSync.native(absolute)
}

const ENV_KEYS = ['QUICKAI_HOME', 'QUICKAI_WORKSPACE_ROOT'] as const

describe('readEnvPathOverride', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('returns a configured path unchanged', () => {
    process.env.QUICKAI_HOME = '/tmp/quickai'
    expect(readEnvPathOverride('QUICKAI_HOME')).toBe('/tmp/quickai')
  })

  it('treats an unset variable as no override', () => {
    expect(readEnvPathOverride('QUICKAI_HOME')).toBeUndefined()
  })

  it.each(['undefined', 'null', '', '   '])(
    'treats the sentinel value %o as no override',
    (value) => {
      process.env.QUICKAI_HOME = value
      expect(readEnvPathOverride('QUICKAI_HOME')).toBeUndefined()
    }
  )

  it('trims surrounding whitespace from a real path', () => {
    process.env.QUICKAI_HOME = '  /tmp/quickai  '
    expect(readEnvPathOverride('QUICKAI_HOME')).toBe('/tmp/quickai')
  })
})

describe('on-disk roots', () => {
  const saved: Record<string, string | undefined> = {}
  const strayRoot = resolve(process.cwd(), 'undefined')

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    rmSync(fakeHome, { recursive: true, force: true })
  })

  // Regression: a test that restored process.env.QUICKAI_HOME by assigning `undefined` left the
  // string "undefined" behind, which resolved every root to ./undefined and created it on disk.
  it('does not create a ./undefined tree when the env var holds the string "undefined"', () => {
    expect(existsSync(strayRoot)).toBe(false)

    process.env.QUICKAI_HOME = 'undefined'
    const root = getQuickAiRoot()
    getMemoriesRoot()
    getSkillRoot()

    expect(root).not.toBe(strayRoot)
    expect(existsSync(strayRoot)).toBe(false)
    expect(existsSync(join(fakeHome, '.quickai'))).toBe(true)
  })

  it('falls back to the workspace under the app root when the override is a sentinel', () => {
    process.env.QUICKAI_WORKSPACE_ROOT = 'undefined'
    const workspace = getWorkspaceRoot()

    expect(workspace).not.toBe(strayRoot)
    expect(workspace.endsWith('workspace')).toBe(true)
  })

  it('honours a real override', () => {
    const configured = join(tmpdir(), 'quickai-paths-test-explicit')
    process.env.QUICKAI_HOME = configured
    expect(getQuickAiRoot()).toBe(canonical(configured))
    rmSync(configured, { recursive: true, force: true })
  })
})
