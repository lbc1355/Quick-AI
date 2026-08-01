/**
 * Filesystem-path policy primitives.
 *
 * No fs, no electron: `resolve`/`relative` only touch the path string and process.cwd, so these
 * containment checks can run before a tool is dispatched. Kept separate from command-string
 * parsing (commandSafety.ts) and from the guard policy that consumes them (constitution.ts), so
 * path policy and command parsing stop bleeding into each other.
 */

import { homedir } from 'os'
import { isAbsolute, join, relative, resolve } from 'path'

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

const SENSITIVE_BASENAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.dockercfg',
  'credentials.json',
  'secrets.json'
])

const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.pfx', '.p12', '.cert', '.crt', '.der']

/**
 * Is a filesystem path (or path argument) targeting a sensitive file — dotenv files, credential
 * stores, SSH private keys, cert/key material, or files inside well-known secret directories
 * (.ssh, .aws, .kube, .docker, ~/.config/git). Lexical only (no fs, no electron), so it runs
 * before dispatch and is shared by the guard layer (escalate to ask) and the tool layer (refuse
 * read/write). One canonical list so the two layers can never drift apart.
 */
export function isSensitiveFileName(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const segments = value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
  const base = segments[segments.length - 1]
  if (!base) return false

  if (base === '.env' || base.startsWith('.env.')) return true
  if (SENSITIVE_BASENAMES.has(base)) return true
  if (SENSITIVE_EXTENSIONS.some((ext) => base.endsWith(ext))) return true

  // Path-aware rules: files under secret/config home directories.
  if (segments.includes('.ssh') || segments.includes('.gnupg')) return true
  if (segments.includes('.aws') && (base === 'credentials' || base === 'config')) return true
  if (segments.includes('.kube') && base === 'config') return true
  if (segments.includes('.docker') && base === 'config.json') return true
  if (segments.includes('.config') && segments.includes('git') && base === 'credentials')
    return true
  return false
}

const SECRET_HOME_SUBDIRS = [
  '.ssh',
  '.aws',
  '.kube',
  '.config',
  '.npm',
  '.cache',
  '.docker',
  '.gnupg',
  '.password-store'
]

/** OS-level directory zones that must never become an agent reference root. */
function getProtectedRootZones(): string[] {
  const zones: string[] = []
  const homeDir = homedir()
  if (homeDir) {
    for (const sub of SECRET_HOME_SUBDIRS) zones.push(join(homeDir, sub))
  }
  if (process.platform === 'win32') {
    // Resolve from env vars so systems installed on a non-C: drive are protected too.
    const systemRoot = process.env.SystemRoot || process.env.windir
    if (systemRoot) zones.push(systemRoot)
    if (process.env.ProgramFiles) zones.push(process.env.ProgramFiles)
    if (process.env['ProgramFiles(x86)']) zones.push(process.env['ProgramFiles(x86)'])
    if (process.env.ProgramData) zones.push(process.env.ProgramData)
  } else {
    zones.push('/etc', '/usr', '/bin', '/sbin', '/var', '/boot', '/dev', '/proc', '/sys', '/root')
  }
  return zones
}

/**
 * Should a directory be refused as an agent reference root (workspace_add_root)? The user's home
 * directory itself, well-known secret/credential subdirectories of home (.ssh, .aws, .kube,
 * .config, .npm, ...), and OS system zones are off-limits. Ordinary project directories — including
 * ones that happen to live under the home folder — remain addable.
 */
export function isSensitiveDirectoryForRoot(realPath: string): boolean {
  const homeDir = homedir()
  if (homeDir && normalizeComparablePath(realPath) === normalizeComparablePath(homeDir)) return true
  return getProtectedRootZones().some((zone) => isPathInsideRoot(realPath, zone))
}
