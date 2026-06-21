import { relative, join, extname } from 'path'
import { promises as fs } from 'fs'
import { ToolExecutionContext } from './types'
import { isSensitiveFile } from './helpers'
import type { FileRootArg } from './filePathSafety'
import { chooseBaseRoot, isPathInsideRoot } from './filePathSafety'
import { buildSymbolDefinitionPatterns, findSymbolMatchesInContent } from './codeSymbolPatterns'
import type { SymbolMatch } from './codeSymbolTypes'

const CODE_SYMBOL_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.cs',
  '.cpp',
  '.cc',
  '.cxx',
  '.c',
  '.h',
  '.hpp',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.kt',
  '.kts',
  '.swift'
])

const CODE_SYMBOL_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  'coverage',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'Library',
  'Temp',
  'Logs',
  'obj',
  'bin',
  '.gradle'
])

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

export async function scanWorkspaceForSymbol(
  symbol: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): Promise<{ matches: SymbolMatch[]; truncatedReason?: string }> {
  const rootInfo = chooseBaseRoot('.', ctx, requestedRoot)
  const root = rootInfo.root
  const matches: SymbolMatch[] = []
  const patterns = buildSymbolDefinitionPatterns(symbol)
  const startTime = Date.now()
  const MAX_FILES = 2500
  const MAX_DIRS = 1200
  const SEARCH_TIMEOUT_MS = 10000
  const YIELD_EVERY_ENTRIES = 60
  const MAX_BLOCKING_MS = 24
  let filesScanned = 0
  let dirsScanned = 0
  let entriesSinceYield = 0
  let lastYieldAt = Date.now()
  let truncatedReason: string | undefined

  const yieldIfNeeded = async (): Promise<void> => {
    entriesSinceYield++
    if (entriesSinceYield < YIELD_EVERY_ENTRIES && Date.now() - lastYieldAt < MAX_BLOCKING_MS) {
      return
    }
    entriesSinceYield = 0
    lastYieldAt = Date.now()
    await yieldToEventLoop()
  }

  const walk = async (dir: string): Promise<void> => {
    if (truncatedReason || ctx.signal.aborted) return
    await yieldIfNeeded()
    if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
      truncatedReason = 'Time limit exceeded'
      return
    }
    dirsScanned++
    if (dirsScanned > MAX_DIRS) {
      truncatedReason = 'Maximum directory scan limit reached'
      return
    }

    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const dirent of dirents) {
      if (truncatedReason || ctx.signal.aborted) break
      await yieldIfNeeded()
      const candidatePath = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (CODE_SYMBOL_IGNORE_DIRS.has(dirent.name)) {
          continue
        }
        await walk(candidatePath)
        continue
      }

      if (!dirent.isFile() || dirent.isSymbolicLink()) continue
      const ext = extname(dirent.name).toLowerCase()
      if (!CODE_SYMBOL_EXTENSIONS.has(ext)) continue
      if (!isPathInsideRoot(candidatePath, root) || isSensitiveFile(candidatePath)) continue

      filesScanned++
      if (filesScanned > MAX_FILES) {
        truncatedReason = 'Maximum file scan limit reached'
        break
      }

      try {
        const stats = await fs.stat(candidatePath)
        if (stats.size > 512 * 1024) continue
        const content = await fs.readFile(candidatePath, 'utf-8')
        if (!content.includes(symbol)) continue
        matches.push(
          ...findSymbolMatchesInContent(
            content,
            symbol,
            {
              realPath: candidatePath,
              relPath: relative(root, candidatePath).replace(/\\/g, '/'),
              root,
              rootKind: rootInfo.rootKind
            },
            patterns
          )
        )
        if (matches.length >= 50) {
          truncatedReason = 'Maximum symbol match limit reached'
          break
        }
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  await walk(root)
  if (ctx.signal.aborted) throw new Error('Agent execution aborted by user.')
  return { matches, truncatedReason }
}
