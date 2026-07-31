import { resolve, normalize, relative, isAbsolute, basename, join, dirname } from 'path'
import { Notification } from 'electron'
import { realpathSync } from 'fs'
import { isSensitiveFileName } from '../agent/pathPolicy'
import { getWorkspaceRoot as resolveWorkspaceRoot } from '../paths'

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
  return resolveWorkspaceRoot()
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
  // Single canonical list lives in the pure path-policy module; this keeps the tool layer and the
  // guard layer (constitution.ts) from drifting apart.
  return isSensitiveFileName(filePath)
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Human-readable byte size (B / KB / MB), used by file-size limit messages in read tools. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export const SEARCH_IGNORE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.mp4',
  '.mp3',
  '.wav',
  '.ogg',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.bz2',
  '.xz',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.class',
  '.pyc',
  '.o',
  '.a',
  '-lock.json',
  '.lock',
  '-lock.yaml',
  '.lockb'
]

/** Send a desktop notification. Returns false when unsupported on this platform. */
export function showDesktopNotification(
  title: string,
  body: string,
  onClick?: () => void
): boolean {
  try {
    if (!Notification.isSupported()) return false
    const n = new Notification({ title, body })
    if (onClick) n.on('click', onClick)
    n.show()
    return true
  } catch {
    return false
  }
}
