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

/**
 * Read a path override from the environment, treating unusable values as unset.
 *
 * `process.env` coerces every assigned value with `String()`, so a restore like
 * `process.env.QUICKAI_HOME = savedValue` where `savedValue` is `undefined` leaves the literal
 * string "undefined" behind instead of clearing the key. That string is truthy, so a plain
 * `process.env.X || fallback` silently resolves the root to `./undefined` relative to cwd — and
 * `ensureDir` then creates it. Filter those sentinels out here so a single bad restore cannot
 * redirect every on-disk root.
 */
export function readEnvPathOverride(name: string): string | undefined {
  const raw = process.env[name]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed === 'undefined' || trimmed === 'null') return undefined
  return trimmed
}

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
  const root = readEnvPathOverride('QUICKAI_HOME') || join(homedir(), '.quickai')
  return ensureDir(normalize(resolve(root)))
}

export function getMemoriesRoot(): string {
  return ensureDir(join(getQuickAiRoot(), 'memories'))
}

export function getLogsRoot(): string {
  return ensureDir(join(getQuickAiRoot(), 'logs'))
}

export function getWorkspaceRoot(): string {
  const configured = readEnvPathOverride('QUICKAI_WORKSPACE_ROOT')
  const root = configured ? normalize(resolve(configured)) : join(getQuickAiRoot(), 'workspace')
  return ensureDir(root)
}

export function getSkillRoot(): string {
  return ensureDir(join(getQuickAiRoot(), 'skill'))
}
