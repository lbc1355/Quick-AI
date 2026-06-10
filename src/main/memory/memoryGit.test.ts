import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { ensureRepo, commit, isGitAvailable, resetGitAvailabilityCache } from './memoryGit'

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `quickai-memgit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  resetGitAvailabilityCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  resetGitAvailabilityCache()
})

describe('memoryGit', () => {
  it('best-effort ops never throw even if git is missing', async () => {
    // Whether or not git exists, these must resolve without throwing.
    await expect(ensureRepo(dir)).resolves.toBeUndefined()
    await expect(commit(dir, 'test commit')).resolves.toBeTypeOf('boolean')
  })

  it('initializes a repo and commits when git is available', async () => {
    if (!(await isGitAvailable())) return // skip on machines without git
    await ensureRepo(dir)
    expect(existsSync(join(dir, '.git'))).toBe(true)

    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'a.md'), 'hello')
    const committed = await commit(dir, 'memory: add a.md')
    expect(committed).toBe(true)
  })
})
