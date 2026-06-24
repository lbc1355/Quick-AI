import { promises as fs } from 'fs'
import { globToRegex } from './workspaceGlob'
import { DEFAULT_IGNORED_DIRECTORIES, walkWorkspace } from './workspaceWalker'

export { DEFAULT_IGNORED_DIRECTORIES } from './workspaceWalker'

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
  includeIgnoredDirectories?: boolean
}

export interface WorkspaceListScanResult {
  matches: WorkspaceFileMatch[]
  scanTruncatedReason?: string
  ignoredDirectories: string[]
  skippedIgnoredDirectories: string[]
}

const MAX_FILES_SCANNED = 5000
const MAX_DIRS_SCANNED = 1000
const SEARCH_TIMEOUT_MS = 10000

export async function scanWorkspaceFiles(
  options: WorkspaceListScanOptions
): Promise<WorkspaceListScanResult> {
  const globRegex = globToRegex(options.globPattern)
  const startedAt = Date.now()
  const matches: WorkspaceFileMatch[] = []
  const skippedIgnoredDirectories = new Set<string>()

  const walkResult = await walkWorkspace({
    root: options.root,
    signal: options.signal,
    maxFiles: MAX_FILES_SCANNED,
    maxDirs: MAX_DIRS_SCANNED,
    timeoutMs: SEARCH_TIMEOUT_MS,
    startedAt,
    ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES,
    includeIgnoredDirectories: options.includeIgnoredDirectories,
    shouldStop: () => matches.length >= options.limit,
    shouldVisitFile: (entry) => globRegex.test(entry.normalizedRelativePath),
    onIgnoredDirectory: (name) => skippedIgnoredDirectories.add(name),
    onFile: async (entry) => {
      try {
        const stats = await fs.stat(entry.absolutePath)
        matches.push({
          relativePath: entry.normalizedRelativePath,
          absolutePath: entry.absolutePath,
          size: stats.size,
          modifiedTime: stats.mtime.toISOString()
        })
      } catch {
        // Ignore files we cannot stat.
      }
    }
  })

  return {
    matches,
    scanTruncatedReason: walkResult.truncatedReason,
    ignoredDirectories: options.includeIgnoredDirectories ? [] : [...DEFAULT_IGNORED_DIRECTORIES],
    skippedIgnoredDirectories: [...skippedIgnoredDirectories].sort()
  }
}
