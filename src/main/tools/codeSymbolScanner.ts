import { extname } from 'path'
import { promises as fs } from 'fs'
import { ToolExecutionContext } from './types'
import type { FileRootArg } from './filePathSafety'
import { chooseBaseRoot } from './filePathSafety'
import { buildSymbolDefinitionPatterns, findSymbolMatchesInContent } from './codeSymbolPatterns'
import type { SymbolMatch } from './codeSymbolTypes'
import { DEFAULT_IGNORED_DIRECTORIES, walkWorkspace } from './workspaceWalker'

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

const CODE_SYMBOL_EXTRA_IGNORED_DIRECTORIES = [
  '.next',
  '.turbo',
  'coverage',
  'target',
  'vendor',
  'Library',
  'Temp',
  'Logs',
  'obj',
  'bin',
  '.gradle'
]

const MAX_FILES = 2500
const MAX_DIRS = 1200
const SEARCH_TIMEOUT_MS = 10000
const MAX_SYMBOL_MATCHES = 50
const MAX_SEARCH_FILE_BYTES = 512 * 1024

export async function scanWorkspaceForSymbol(
  symbol: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): Promise<{ matches: SymbolMatch[]; truncatedReason?: string }> {
  const rootInfo = chooseBaseRoot('.', ctx, requestedRoot)
  const root = rootInfo.root
  const startedAt = Date.now()
  const matches: SymbolMatch[] = []
  const patterns = buildSymbolDefinitionPatterns(symbol)
  let truncatedReason: string | undefined

  const walkResult = await walkWorkspace({
    root,
    signal: ctx.signal,
    maxFiles: MAX_FILES,
    maxDirs: MAX_DIRS,
    timeoutMs: SEARCH_TIMEOUT_MS,
    startedAt,
    ignoredDirectories: [...DEFAULT_IGNORED_DIRECTORIES, ...CODE_SYMBOL_EXTRA_IGNORED_DIRECTORIES],
    yieldEveryEntries: 60,
    maxBlockingMs: 24,
    shouldStop: () => matches.length >= MAX_SYMBOL_MATCHES || Boolean(truncatedReason),
    shouldVisitFile: (entry) =>
      CODE_SYMBOL_EXTENSIONS.has(extname(entry.dirent.name).toLowerCase()),
    onFile: async (entry) => {
      try {
        const stats = await fs.stat(entry.absolutePath)
        if (stats.size > MAX_SEARCH_FILE_BYTES) return
        const content = await fs.readFile(entry.absolutePath, 'utf-8')
        if (!content.includes(symbol)) return
        matches.push(
          ...findSymbolMatchesInContent(
            content,
            symbol,
            {
              realPath: entry.absolutePath,
              relPath: entry.normalizedRelativePath,
              root,
              rootKind: rootInfo.rootKind
            },
            patterns
          )
        )
        if (matches.length >= MAX_SYMBOL_MATCHES) {
          truncatedReason = 'Maximum symbol match limit reached'
        }
      } catch {
        // Ignore unreadable files.
      }
    }
  })

  if (ctx.signal.aborted) throw new Error('Agent execution aborted by user.')
  return { matches, truncatedReason: truncatedReason || walkResult.truncatedReason }
}
