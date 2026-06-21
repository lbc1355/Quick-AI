import { promises as fs } from 'fs'
import { join, relative } from 'path'
import { isSensitiveFile } from './helpers'
import { isPathInsideRoot } from './filePathSafety'
import { globToRegex } from './workspaceGlob'

export interface WorkspaceFileMatch {
  relativePath: string
  absolutePath: string
  size: number
  modifiedTime: string
}

export interface WorkspaceListScanOptions {
  root: string
  globPattern: string
  limit: number
  signal: AbortSignal
}

export interface WorkspaceListScanResult {
  matches: WorkspaceFileMatch[]
  scanTruncatedReason?: string
}

const MAX_FILES_SCANNED = 5000
const MAX_DIRS_SCANNED = 1000
const SEARCH_TIMEOUT_MS = 10000
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'build'])

const normalizeRelativePath = (path: string): string => path.replace(/\\/g, '/')

export async function scanWorkspaceFiles(
  options: WorkspaceListScanOptions
): Promise<WorkspaceListScanResult> {
  let filesScanned = 0
  let dirsScanned = 0
  const startTime = Date.now()
  let scanTruncatedReason: string | undefined = undefined

  const globRegex = globToRegex(options.globPattern)
  const matches: WorkspaceFileMatch[] = []

  const walk = async (dir: string): Promise<void> => {
    if (options.signal.aborted || scanTruncatedReason) return

    if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
      scanTruncatedReason = 'Time limit exceeded'
      return
    }

    dirsScanned++
    if (dirsScanned > MAX_DIRS_SCANNED) {
      scanTruncatedReason = 'Maximum directory scan limit reached'
      return
    }

    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      if (matches.length >= options.limit || scanTruncatedReason || options.signal.aborted) break
      const resPath = join(dir, dirent.name)
      const relPath = relative(options.root, resPath)

      if (dirent.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirent.name)) {
          continue
        }
        await walk(resPath)
        continue
      }

      filesScanned++
      if (filesScanned > MAX_FILES_SCANNED) {
        scanTruncatedReason = 'Maximum file scan limit reached'
        break
      }

      if (dirent.isSymbolicLink()) continue

      const normalizedRelPath = normalizeRelativePath(relPath)
      if (!globRegex.test(normalizedRelPath)) {
        continue
      }

      if (!isPathInsideRoot(resPath, options.root) || isSensitiveFile(resPath)) {
        continue
      }

      try {
        const stats = await fs.stat(resPath)
        matches.push({
          relativePath: normalizedRelPath,
          absolutePath: resPath,
          size: stats.size,
          modifiedTime: stats.mtime.toISOString()
        })
      } catch {
        // Ignore files we cannot stat.
      }
    }
  }

  await walk(options.root)

  return {
    matches,
    scanTruncatedReason
  }
}
