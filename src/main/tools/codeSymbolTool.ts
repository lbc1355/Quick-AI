import { relative, join, extname } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import { escapeRegExp, isSensitiveFile } from './helpers'
import type { FileRootArg, FileRootKind } from './filePathSafety'
import {
  ROOT_PARAMETER,
  chooseBaseRoot,
  getRootArg,
  isPathInsideRoot,
  resolveExistingSafePath
} from './filePathSafety'
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

const MAX_SYMBOL_MATCH_LINE_CHARS = 2000
const MAX_BLOCK_SCAN_LINE_CHARS = 8000
const MAX_SYMBOL_BLOCK_CHARS = 60000
const MAX_SYMBOL_BLOCK_LINE_CHARS = 1200

interface SymbolMatch {
  realPath: string
  relPath: string
  root: string
  rootKind: FileRootKind
  lineIndex: number
  lineNumber: number
  lineText: string
  kind: string
}

function normalizeLineNumberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback
}
function buildSymbolDefinitionPatterns(symbol: string): Array<{ kind: string; regex: RegExp }> {
  const s = escapeRegExp(symbol)
  return [
    {
      kind: 'function',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${s}\\s*\\(`)
    },
    {
      kind: 'function',
      regex: new RegExp(
        `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${s}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`
      )
    },
    {
      kind: 'method',
      regex: new RegExp(
        `^\\s*(?:(?:public|private|protected|static|async|override|readonly)\\s+)*${s}\\s*(?:<[^>]+>)?\\s*\\(`
      )
    },
    {
      kind: 'class',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+${s}\\b`)
    },
    { kind: 'interface', regex: new RegExp(`^\\s*(?:export\\s+)?interface\\s+${s}\\b`) },
    { kind: 'type', regex: new RegExp(`^\\s*(?:export\\s+)?type\\s+${s}\\b`) },
    { kind: 'enum', regex: new RegExp(`^\\s*(?:export\\s+)?enum\\s+${s}\\b`) },
    { kind: 'python_function', regex: new RegExp(`^\\s*(?:async\\s+)?def\\s+${s}\\s*\\(`) },
    { kind: 'python_class', regex: new RegExp(`^\\s*class\\s+${s}\\b`) },
    { kind: 'rust_function', regex: new RegExp(`^\\s*(?:pub\\s+)?fn\\s+${s}\\s*\\(`) },
    { kind: 'go_function', regex: new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${s}\\s*\\(`) },
    {
      kind: 'c_like_function',
      regex: new RegExp(
        `^\\s*[\\w:<>,~*&\\[\\]\\s]{1,180}\\b${s}\\s*\\([^;]{0,300}\\)\\s*(?:const\\s*)?(?:\\{|$)`
      )
    }
  ]
}

function lineMayContainSymbol(line: string, symbol: string): boolean {
  const index = line.indexOf(symbol)
  if (index === -1) return false

  const before = index > 0 ? line[index - 1] : ''
  const after = index + symbol.length < line.length ? line[index + symbol.length] : ''
  const isIdentifierChar = (ch: string): boolean => /[\w$]/.test(ch)
  return !isIdentifierChar(before) && !isIdentifierChar(after)
}

function findSymbolMatchesInContent(
  content: string,
  symbol: string,
  target: Pick<SymbolMatch, 'realPath' | 'relPath' | 'root' | 'rootKind'>,
  patterns = buildSymbolDefinitionPatterns(symbol)
): SymbolMatch[] {
  const lines = content.split(/\r?\n/)
  const matches: SymbolMatch[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > MAX_SYMBOL_MATCH_LINE_CHARS) continue
    if (!lineMayContainSymbol(line, symbol)) continue
    const pattern = patterns.find((p) => p.regex.test(line))
    if (!pattern) continue
    matches.push({
      ...target,
      lineIndex: i,
      lineNumber: i + 1,
      lineText: line.trim(),
      kind: pattern.kind
    })
  }

  return matches
}

function countIndent(line: string): number {
  let count = 0
  for (const ch of line) {
    if (ch === ' ') count += 1
    else if (ch === '\t') count += 2
    else break
  }
  return count
}

function includeLeadingDecorators(lines: string[], start: number): number {
  let current = start
  while (current > 0) {
    const previous = lines[current - 1].trim()
    if (!previous.startsWith('@')) break
    current--
  }
  return current
}

function stripQuotedText(line: string): string {
  const bounded =
    line.length > MAX_BLOCK_SCAN_LINE_CHARS ? line.slice(0, MAX_BLOCK_SCAN_LINE_CHARS) : line
  return bounded
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

function inferSymbolBlockRange(
  lines: string[],
  matchLineIndex: number,
  maxLines: number,
  contextLines: number
): { startIndex: number; endIndex: number; truncated: boolean } {
  const definitionLine = lines[matchLineIndex]
  const trimmed = definitionLine.trim()
  const scanLimit = Math.min(lines.length, matchLineIndex + maxLines)
  let blockStart = includeLeadingDecorators(lines, matchLineIndex)
  let blockEnd = matchLineIndex
  let truncated = false

  if (/^(?:async\s+)?def\s+|^class\s+/.test(trimmed)) {
    const baseIndent = countIndent(definitionLine)
    blockEnd = lines.length - 1
    for (let i = matchLineIndex + 1; i < scanLimit; i++) {
      const line = lines[i]
      const clean = line.trim()
      if (!clean) continue
      if (countIndent(line) <= baseIndent && !clean.startsWith('#')) {
        blockEnd = i - 1
        break
      }
    }
    if (blockEnd >= scanLimit - 1 && scanLimit < lines.length) truncated = true
  } else {
    let sawBrace = false
    let depth = 0
    for (let i = matchLineIndex; i < scanLimit; i++) {
      const line = stripQuotedText(lines[i])
      for (const ch of line) {
        if (ch === '{') {
          sawBrace = true
          depth++
        } else if (ch === '}') {
          depth--
        }
      }
      blockEnd = i
      if (sawBrace && depth <= 0) break
      if (!sawBrace && /;\s*$/.test(line)) break
    }
    if (blockEnd >= scanLimit - 1 && scanLimit < lines.length) truncated = true
  }

  blockStart = Math.max(0, blockStart - contextLines)
  blockEnd = Math.min(lines.length - 1, blockEnd + contextLines)
  return { startIndex: blockStart, endIndex: blockEnd, truncated }
}

function buildBoundedSymbolBlock(lines: string[]): { block: string; truncated: boolean } {
  const out: string[] = []
  let totalChars = 0
  let truncated = false

  for (const rawLine of lines) {
    const line =
      rawLine.length > MAX_SYMBOL_BLOCK_LINE_CHARS
        ? `${rawLine.slice(0, MAX_SYMBOL_BLOCK_LINE_CHARS)}...[line truncated]`
        : rawLine
    const nextTotal = totalChars + line.length + 1
    if (nextTotal > MAX_SYMBOL_BLOCK_CHARS) {
      truncated = true
      break
    }
    out.push(line)
    totalChars = nextTotal
    if (rawLine.length > MAX_SYMBOL_BLOCK_LINE_CHARS) {
      truncated = true
    }
  }

  return { block: out.join('\n'), truncated }
}

async function scanWorkspaceForSymbol(
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

export const codeSymbolTool: ToolDefinition = {
  name: 'code_symbol_read',
  title: 'Read Code Symbol',
  description:
    'Locate a function, class, method, type, interface, or enum by symbol name and return the surrounding code block with file and line metadata. If path is omitted, searches the current project/global workspace.',
  tags: [
    'code',
    'symbol',
    'definition',
    'function',
    'class',
    'method',
    'jump',
    '定位',
    '函数',
    '类',
    '代码块'
  ],
  dependencies: ['file_read', 'workspace_search'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to locate, such as a function, class, method, type, or enum.'
      },
      path: {
        type: 'string',
        description:
          'Optional file path to search first. If omitted, the tool searches the current project/global workspace.'
      },
      root: ROOT_PARAMETER,
      contextLines: {
        type: 'number',
        description: 'Extra lines before and after the symbol block (default: 2).'
      },
      maxLines: {
        type: 'number',
        description: 'Maximum lines to return for the symbol block (default: 240, max: 500).'
      }
    },
    required: ['symbol']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : ''
    if (!symbol) throw new Error('Missing or invalid symbol parameter')

    const contextLines = Math.min(normalizeLineNumberArg(args.contextLines, 2), 20)
    const maxLines = Math.min(normalizeLineNumberArg(args.maxLines, 240), 500)
    const requestedRoot = getRootArg(args)
    const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path : ''

    let matches: SymbolMatch[] = []
    let truncatedReason: string | undefined

    if (requestedPath) {
      const target = await resolveExistingSafePath(requestedPath, ctx, 'Path', requestedRoot)
      const stats = await fs.stat(target.realPath)
      if (stats.isDirectory()) throw new Error('Path is a directory, not a file.')
      if (stats.size > 2 * 1024 * 1024) {
        throw new Error(
          `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
        )
      }
      const content = await fs.readFile(target.realPath, 'utf-8')
      matches = findSymbolMatchesInContent(content, symbol, {
        realPath: target.realPath,
        relPath: target.relPath,
        root: target.root,
        rootKind: target.rootKind
      })
    } else {
      const scanResult = await scanWorkspaceForSymbol(symbol, ctx, requestedRoot)
      matches = scanResult.matches
      truncatedReason = scanResult.truncatedReason
    }

    if (matches.length === 0) {
      return {
        resultForModel:
          `No definition-like symbol match found for "${symbol}".` +
          (requestedPath
            ? ' Try workspace_search for text references or verify the file path.'
            : ' Try workspace_search with the symbol text or provide a path.'),
        resultForUi: {
          title: `Code Symbol: ${symbol}`,
          summary: 'No definition-like symbol match found'
        }
      }
    }

    const best = matches[0]
    const content = await fs.readFile(best.realPath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const range = inferSymbolBlockRange(lines, best.lineIndex, maxLines, contextLines)
    const blockResult = buildBoundedSymbolBlock(lines.slice(range.startIndex, range.endIndex + 1))
    const candidateLines = matches.slice(0, 10).map((match, index) => {
      const selected = match === best ? ' selected' : ''
      return `${index + 1}. ${match.relPath}:${match.lineNumber} (${match.kind})${selected} - ${match.lineText.slice(0, 140)}`
    })

    if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(best.realPath)

    const resultForModel = [
      `Root (${best.rootKind}): ${best.root}`,
      `Symbol: ${symbol}`,
      `Kind: ${best.kind}`,
      `File: ${best.relPath}`,
      `Definition Line: ${best.lineNumber} of ${lines.length}`,
      `Block Lines: ${range.startIndex + 1}-${range.endIndex + 1} of ${lines.length}`,
      matches.length > 1 ? `Candidates:\n${candidateLines.join('\n')}` : '',
      truncatedReason ? `Warning: Symbol search was truncated. Reason: ${truncatedReason}` : '',
      range.truncated ? 'Warning: Symbol block was truncated by maxLines.' : '',
      blockResult.truncated
        ? `Warning: Symbol block output was truncated to keep the UI responsive.`
        : '',
      `Content:\n${blockResult.block}`
    ]
      .filter(Boolean)
      .join('\n\n')

    return {
      resultForModel,
      resultForUi: {
        title: `Code Symbol: ${symbol}`,
        url: `file:///${best.realPath.replace(/\\/g, '/')}`,
        summary: `${best.relPath}:${best.lineNumber} (${best.kind}), lines ${range.startIndex + 1}-${range.endIndex + 1}`
      }
    }
  }
}
