import { homedir } from 'os'
import { join, normalize, resolve } from 'path'
import { existsSync, mkdirSync, realpathSync } from 'fs'

/**
 * Central resolver for QuickAI's on-disk roots, all under `~/.quickai`.
 *
 *   ~/.quickai/
 *     memories/    durable Markdown memory library (git-versioned)
 *     workspace/   agent file-tool sandbox root
 *     skill/       folder-style skill packages
 *
 * `QUICKAI_HOME` overrides the root (used by tests to point at a temp dir).
 * `QUICKAI_WORKSPACE_ROOT` is kept for backward compatibility and, when set,
 * overrides only the workspace path.
 */

function ensureDir(path: string): string {
  if (!existsSync(path)) {
    try {
      mkdirSync(path, { recursive: true })
    } catch (err) {
      console.error(`Failed to create directory ${path}:`, err)
    }
  }
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

export function getQuickAiRoot(): string {
  const root = process.env.QUICKAI_HOME || join(homedir(), '.quickai')
  return ensureDir(normalize(resolve(root)))
}

export function getMemoriesRoot(): string {
  return ensureDir(join(getQuickAiRoot(), 'memories'))
}

export function getWorkspaceRoot(): string {
  const configured = process.env.QUICKAI_WORKSPACE_ROOT
  const root = configured ? normalize(resolve(configured)) : join(getQuickAiRoot(), 'workspace')
  return ensureDir(root)
}

export function getSkillRoot(): string {
  return ensureDir(join(getQuickAiRoot(), 'skill'))
}
