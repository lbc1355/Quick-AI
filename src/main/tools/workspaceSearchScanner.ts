import { promises as fs } from 'fs'
import { SEARCH_IGNORE_EXTENSIONS, escapeRegExp } from './helpers'
import { globToRegex } from './workspaceGlob'
import { walkWorkspace } from './workspaceWalker'

export interface WorkspaceSearchMatch {
  relativePath: string
  absolutePath: string
  lineNumber: number
  lineContent: string
  contextBefore: string[]
  contextAfter: string[]
}

export interface WorkspaceSearchScanOptions {
  root: string
  query: string
  globPattern?: string
  caseSensitive: boolean
  limit: number
  signal: AbortSignal
}

export interface WorkspaceSearchScanResult {
  matches: WorkspaceSearchMatch[]
  scanTruncatedReason?: string
}

const MAX_FILES_SCANNED = 5000
const MAX_DIRS_SCANNED = 1000
const SEARCH_TIMEOUT_MS = 10000
const MAX_SEARCH_FILE_BYTES = 512 * 1024
const MAX_LINE_LEN = 300
const SEARCH_IGNORED_DIRECTORIES = ['.git', 'node_modules', 'dist', 'out', 'build']

const truncLine = (line: string): string =>
  line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + '...' : line

export async function scanWorkspaceForText(
  options: WorkspaceSearchScanOptions
): Promise<WorkspaceSearchScanResult> {
  const searchRegex = new RegExp(escapeRegExp(options.query), options.caseSensitive ? '' : 'i')
  const globRegex = options.globPattern ? globToRegex(options.globPattern) : undefined
  const startedAt = Date.now()
  const matches: WorkspaceSearchMatch[] = []

  const walkResult = await walkWorkspace({
    root: options.root,
    signal: options.signal,
    maxFiles: MAX_FILES_SCANNED,
    maxDirs: MAX_DIRS_SCANNED,
    timeoutMs: SEARCH_TIMEOUT_MS,
    startedAt,
    ignoredDirectories: SEARCH_IGNORED_DIRECTORIES,
    shouldStop: () => matches.length >= options.limit,
    shouldVisitFile: (entry) => {
      if (globRegex && !globRegex.test(entry.normalizedRelativePath)) return false
      const lowerName = entry.dirent.name.toLowerCase()
      return !SEARCH_IGNORE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    },
    onFile: async (entry) => {
      try {
        const stats = await fs.stat(entry.absolutePath)
        if (stats.size > MAX_SEARCH_FILE_BYTES) return
      } catch {
        return
      }

      try {
        const content = await fs.readFile(entry.absolutePath, 'utf-8')
        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= options.limit || options.signal.aborted) break
          const line = lines[i]
          if (searchRegex.test(line)) {
            const lineNumber = i + 1
            const contextBefore = lines.slice(Math.max(0, i - 1), i)
            const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 2))
            matches.push({
              relativePath: entry.normalizedRelativePath,
              absolutePath: entry.absolutePath,
              lineNumber,
              lineContent: truncLine(line),
              contextBefore: contextBefore.map(truncLine),
              contextAfter: contextAfter.map(truncLine)
            })
          }
        }
      } catch {
        // Ignore unreadable/binary files.
      }
    }
  })

  return {
    matches,
    scanTruncatedReason: walkResult.truncatedReason
  }
}
