/**
 * Filesystem-path policy primitives.
 *
 * No fs, no electron: `resolve`/`relative` only touch the path string and process.cwd, so these
 * containment checks can run before a tool is dispatched. Kept separate from command-string
 * parsing (commandSafety.ts) and from the guard policy that consumes them (constitution.ts), so
 * path policy and command parsing stop bleeding into each other.
 */

import { isAbsolute, relative, resolve } from 'path'

/**
 * Canonicalize a path for equality comparison: resolve it, use forward slashes, drop a trailing
 * slash (but never reduce a root like "/" to ""), and lowercase on Windows (case-insensitive FS).
 */
export function normalizeComparablePath(filePath: string): string {
  const normalized = resolve(filePath).replace(/\\/g, '/')
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/** Is `filePath` the same as, or nested inside, `root` — after canonicalizing both? */
export function isPathInsideRoot(filePath: string, root: string): boolean {
  const target = normalizeComparablePath(filePath)
  const base = normalizeComparablePath(root)
  if (target === base) return true
  const rel = relative(base, target)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Does `inputPath`, interpreted relative to a workspace root, lexically escape that root —
 * without touching the filesystem? Absolute paths, home references, and `..` traversal that
 * climbs above the root all count as escapes. `foo..bar` (a literal name) does not.
 */
export function pathEscapesWorkspace(inputPath: string): boolean {
  if (typeof inputPath !== 'string' || inputPath.length === 0) return false

  const normalized = inputPath.replace(/\\/g, '/').trim()

  // Home-relative or environment-variable expansions resolve outside a fixed workspace root.
  if (normalized.startsWith('~')) return true
  if (/\$(HOME|USERPROFILE)\b/.test(normalized) || /%USERPROFILE%/i.test(normalized)) return true

  // Absolute paths bypass the root entirely: POSIX "/...", Windows drive "C:/..." or UNC "//host".
  if (normalized.startsWith('/')) return true
  if (/^[a-zA-Z]:\//.test(normalized)) return true

  // Walk the relative components, tracking depth below the root.
  let depth = 0
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      depth -= 1
      if (depth < 0) return true
    } else {
      depth += 1
    }
  }
  return false
}
