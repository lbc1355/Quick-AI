import { resolve, normalize, relative, isAbsolute, basename, join, dirname } from 'path'
import { realpathSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'

function getComparablePath(filePath: string): string {
  const resolved = normalize(resolve(filePath))
  try {
    return normalize(realpathSync.native(resolved))
  } catch {
    try {
      return normalize(join(realpathSync.native(dirname(resolved)), basename(resolved)))
    } catch {
      return resolved
    }
  }
}

export function getWorkspaceRoot(): string {
  const configuredRoot = process.env.QUICKAI_WORKSPACE_ROOT
  const rootPath = normalize(resolve(configuredRoot || join(homedir(), 'quickai')))
  if (!existsSync(rootPath)) {
    try {
      mkdirSync(rootPath, { recursive: true })
    } catch (err) {
      console.error('Failed to create workspace directory ~/quickai:', err)
    }
  }

  let root = rootPath
  try {
    root = realpathSync.native(rootPath)
  } catch {
    // Ignore and fallback
  }
  return root
}

export function isPathInWorkspace(filePath: string): boolean {
  const root = getComparablePath(getWorkspaceRoot())
  const resolved = getComparablePath(resolve(root, filePath))
  const comparisonRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const comparisonResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const relativePath = relative(comparisonRoot, comparisonResolved)
  if (comparisonResolved === comparisonRoot) return true
  return !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

export function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase()
  if (name === '.env' || name.startsWith('.env.')) {
    return true
  }
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name)) {
    return true
  }
  const sensitiveExtensions = ['.pem', '.key', '.pfx', '.p12', '.cert', '.crt', '.der']
  if (sensitiveExtensions.some((ext) => name.endsWith(ext))) {
    return true
  }
  return false
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const SEARCH_IGNORE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.mp4', '.mp3', '.wav', '.ogg',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.class', '.pyc', '.o', '.a',
  '-lock.json', '.lock', '-lock.yaml', '.lockb'
]
