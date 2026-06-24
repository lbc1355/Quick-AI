import { promises as fs, type Dirent } from 'fs'
import { join, relative } from 'path'
import { isSensitiveFile } from './helpers'
import { isPathInsideRoot } from './filePathSafety'

export const DEFAULT_IGNORED_DIRECTORIES = [
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.venv',
  'venv',
  '.env',
  'env',
  'site-packages',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  'htmlcov'
]

export interface WorkspaceWalkEntry {
  dirent: Dirent
  absolutePath: string
  relativePath: string
  normalizedRelativePath: string
}

export interface WorkspaceWalkOptions {
  root: string
  signal: AbortSignal
  maxFiles: number
  maxDirs: number
  timeoutMs: number
  startedAt?: number
  ignoredDirectories?: Iterable<string>
  includeIgnoredDirectories?: boolean
  yieldEveryEntries?: number
  maxBlockingMs?: number
  shouldStop?: () => boolean
  shouldVisitFile?: (entry: WorkspaceWalkEntry) => boolean | Promise<boolean>
  onIgnoredDirectory?: (name: string, absolutePath: string) => void
  onFile: (entry: WorkspaceWalkEntry) => Promise<void>
}

export interface WorkspaceWalkResult {
  filesScanned: number
  dirsScanned: number
  truncatedReason?: string
}

export const normalizeRelativePath = (path: string): string => path.replace(/\\/g, '/')

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

export async function walkWorkspace(options: WorkspaceWalkOptions): Promise<WorkspaceWalkResult> {
  const startTime = options.startedAt ?? Date.now()
  const ignoredDirectories = new Set(options.ignoredDirectories || [])
  const yieldEveryEntries = options.yieldEveryEntries || 80
  const maxBlockingMs = options.maxBlockingMs || 32
  let filesScanned = 0
  let dirsScanned = 0
  let entriesSinceYield = 0
  let lastYieldAt = Date.now()
  let truncatedReason: string | undefined

  const shouldStopWalk = (): boolean =>
    options.signal.aborted || Boolean(truncatedReason) || Boolean(options.shouldStop?.())

  const yieldIfNeeded = async (): Promise<void> => {
    entriesSinceYield++
    if (entriesSinceYield < yieldEveryEntries && Date.now() - lastYieldAt < maxBlockingMs) {
      return
    }
    entriesSinceYield = 0
    lastYieldAt = Date.now()
    await yieldToEventLoop()
  }

  const walk = async (dir: string): Promise<void> => {
    if (shouldStopWalk()) return
    await yieldIfNeeded()
    if (Date.now() - startTime > options.timeoutMs) {
      truncatedReason = 'Time limit exceeded'
      return
    }

    dirsScanned++
    if (dirsScanned > options.maxDirs) {
      truncatedReason = 'Maximum directory scan limit reached'
      return
    }

    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const dirent of dirents) {
      if (shouldStopWalk()) break
      await yieldIfNeeded()
      if (Date.now() - startTime > options.timeoutMs) {
        truncatedReason = 'Time limit exceeded'
        break
      }

      const absolutePath = join(dir, dirent.name)
      const relativePath = relative(options.root, absolutePath)
      const normalizedRelativePath = normalizeRelativePath(relativePath)

      if (dirent.isDirectory()) {
        if (!options.includeIgnoredDirectories && ignoredDirectories.has(dirent.name)) {
          options.onIgnoredDirectory?.(dirent.name, absolutePath)
          continue
        }
        await walk(absolutePath)
        continue
      }

      if (!dirent.isFile() || dirent.isSymbolicLink()) continue

      if (!isPathInsideRoot(absolutePath, options.root) || isSensitiveFile(absolutePath)) {
        continue
      }

      const entry = { dirent, absolutePath, relativePath, normalizedRelativePath }
      if (options.shouldVisitFile && !(await options.shouldVisitFile(entry))) {
        continue
      }

      filesScanned++
      if (filesScanned > options.maxFiles) {
        truncatedReason = 'Maximum file scan limit reached'
        break
      }
      await options.onFile(entry)
    }
  }

  await walk(options.root)
  return { filesScanned, dirsScanned, truncatedReason }
}
