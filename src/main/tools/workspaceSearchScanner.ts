import { join, relative } from 'path'
import { promises as fs } from 'fs'
import { SEARCH_IGNORE_EXTENSIONS, escapeRegExp, isSensitiveFile } from './helpers'
import { isPathInsideRoot } from './filePathSafety'
import { globToRegex } from './workspaceGlob'

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

const truncLine = (line: string): string =>
  line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + '...' : line

export async function scanWorkspaceForText(
  options: WorkspaceSearchScanOptions
): Promise<WorkspaceSearchScanResult> {
  let filesScanned = 0
  let dirsScanned = 0
  const startTime = Date.now()
  let scanTruncatedReason: string | undefined = undefined

  const searchRegex = new RegExp(escapeRegExp(options.query), options.caseSensitive ? '' : 'i')
  const globRegex = options.globPattern ? globToRegex(options.globPattern) : undefined
  const matches: WorkspaceSearchMatch[] = []

  const walk = async (dir: string): Promise<void> => {
    if (options.signal.aborted || scanTruncatedReason) return

    const nowVal = Date.now()
    if (nowVal - startTime > SEARCH_TIMEOUT_MS) {
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
        if (['.git', 'node_modules', 'dist', 'out', 'build'].includes(dirent.name)) {
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

      if (globRegex) {
        const normalizedRelPath = relPath.replace(/\\/g, '/')
        if (!globRegex.test(normalizedRelPath)) {
          continue
        }
      }

      if (!isPathInsideRoot(resPath, options.root) || isSensitiveFile(resPath)) {
        continue
      }

      const lowerName = dirent.name.toLowerCase()
      if (SEARCH_IGNORE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
        continue
      }

      try {
        const stats = await fs.stat(resPath)
        if (stats.size > MAX_SEARCH_FILE_BYTES) continue
      } catch {
        continue
      }

      try {
        const content = await fs.readFile(resPath, 'utf-8')
        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= options.limit || scanTruncatedReason || options.signal.aborted) {
            break
          }
          const line = lines[i]
          if (searchRegex.test(line)) {
            const lineNumber = i + 1
            const contextBefore = lines.slice(Math.max(0, i - 1), i)
            const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 2))
            matches.push({
              relativePath: relPath,
              absolutePath: resPath,
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
  }

  await walk(options.root)

  return {
    matches,
    scanTruncatedReason
  }
}
