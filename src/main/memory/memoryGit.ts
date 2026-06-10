import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Best-effort git versioning for the Markdown memory library. Shells out to the
 * system `git` binary. If git is unavailable, every operation degrades to a no-op
 * so the memory library still works (just without history).
 */

let gitAvailable: boolean | null = null

function run(
  cwd: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' })
    })
  })
}

export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable
  const res = await run(process.cwd(), ['--version'])
  gitAvailable = res.ok
  return gitAvailable
}

/** Reset the cached availability probe. Test-only. */
export function resetGitAvailabilityCache(): void {
  gitAvailable = null
}

/** Initialize a repo in `dir` if one does not already exist. Best-effort. */
export async function ensureRepo(dir: string): Promise<void> {
  if (!(await isGitAvailable())) return
  if (existsSync(join(dir, '.git'))) return
  await run(dir, ['init'])
  // Local identity so commits succeed even when global git config is absent.
  await run(dir, ['config', 'user.email', 'memory@quickai.local'])
  await run(dir, ['config', 'user.name', 'QuickAI Memory'])
}

/** Stage everything and commit. Returns true when a commit was actually created. */
export async function commit(dir: string, message: string): Promise<boolean> {
  if (!(await isGitAvailable())) return false
  await run(dir, ['add', '-A'])
  const res = await run(dir, ['commit', '-m', message])
  // `git commit` exits non-zero when there is nothing to commit; treat as benign.
  return res.ok
}
