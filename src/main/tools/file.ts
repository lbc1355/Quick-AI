import { resolve, relative, join, dirname, basename, isAbsolute, extname } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import {
  getWorkspaceRoot,
  isSensitiveFile,
  escapeRegExp
} from './helpers'
import { createFileDiffTool, generateUnifiedDiff } from './fileDiff'
import { createFileOperationTools } from './fileOperations'
import { createFileSearchTools } from './fileSearch'

type FileRootKind = 'workspace' | 'project'
type FileRootArg = FileRootKind | undefined

const ROOT_PARAMETER = {
  type: 'string',
  enum: ['workspace', 'project'],
  description:
    'Optional root selector. In project conversations, relative paths default to project; use "workspace" for QuickAI scratch files.'
}

interface SafePath {
  root: string
  rootKind: FileRootKind
  resolvedPath: string
  realPath: string
  relPath: string
}

function getRootArg(args: ToolArgs): FileRootArg {
  return args.root === 'workspace' || args.root === 'project' ? args.root : undefined
}

function getNamedRootArg(args: ToolArgs, key: string): FileRootArg {
  return args[key] === 'workspace' || args[key] === 'project'
    ? (args[key] as FileRootKind)
    : undefined
}

function getProjectRoot(ctx: ToolExecutionContext): string | undefined {
  return ctx.reqId ? getRun(ctx.reqId)?.projectRoot : undefined
}

function normalizeComparablePath(filePath: string): string {
  const normalized = resolve(filePath).replace(/\\/g, '/')
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function isPathInsideRoot(filePath: string, root: string): boolean {
  const target = normalizeComparablePath(filePath)
  const base = normalizeComparablePath(root)
  if (target === base) return true
  const rel = relative(base, target)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function chooseBaseRoot(
  inputPath: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): { root: string; rootKind: FileRootKind } {
  const workspaceRoot = getWorkspaceRoot()
  const projectRoot = getProjectRoot(ctx)
  if (requestedRoot === 'project' && !projectRoot) {
    throw new Error('No project root is attached to this conversation.')
  }
  if (requestedRoot === 'workspace') {
    return { root: workspaceRoot, rootKind: 'workspace' }
  }
  if (!isAbsolute(inputPath) && projectRoot) {
    return { root: projectRoot, rootKind: 'project' }
  }
  return { root: workspaceRoot, rootKind: 'workspace' }
}

function getAccessibleRootForResolvedPath(
  resolvedPath: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): { root: string; rootKind: FileRootKind } {
  const workspaceRoot = getWorkspaceRoot()
  const projectRoot = getProjectRoot(ctx)

  if (requestedRoot === 'workspace') {
    if (isPathInsideRoot(resolvedPath, workspaceRoot)) {
      return { root: workspaceRoot, rootKind: 'workspace' }
    }
    throw new Error('Security Violation: Path is outside the global workspace.')
  }

  if (requestedRoot === 'project') {
    if (!projectRoot) throw new Error('No project root is attached to this conversation.')
    if (isPathInsideRoot(resolvedPath, projectRoot)) {
      return { root: projectRoot, rootKind: 'project' }
    }
    throw new Error('Security Violation: Path is outside the current project root.')
  }

  if (projectRoot && isPathInsideRoot(resolvedPath, projectRoot)) {
    return { root: projectRoot, rootKind: 'project' }
  }
  if (isPathInsideRoot(resolvedPath, workspaceRoot)) {
    return { root: workspaceRoot, rootKind: 'workspace' }
  }
  throw new Error(
    'Security Violation: Path is outside the global workspace and current project root.'
  )
}

async function resolveExistingSafePath(
  inputPath: string,
  ctx: ToolExecutionContext,
  label = 'Path',
  requestedRoot?: FileRootArg
): Promise<SafePath> {
  const base = chooseBaseRoot(inputPath, ctx, requestedRoot)
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base.root, inputPath)
  let rootInfo = getAccessibleRootForResolvedPath(resolvedPath, ctx, requestedRoot)
  let realPath: string
  try {
    realPath = await fs.realpath(resolvedPath)
  } catch {
    throw new Error(`${label} does not exist: ${inputPath}`)
  }

  rootInfo = getAccessibleRootForResolvedPath(realPath, ctx, requestedRoot)

  if (isSensitiveFile(realPath)) {
    throw new Error(`Security Violation: ${label} targets a sensitive file.`)
  }

  return {
    root: rootInfo.root,
    rootKind: rootInfo.rootKind,
    resolvedPath,
    realPath,
    relPath: relative(rootInfo.root, realPath).replace(/\\/g, '/')
  }
}

async function resolveTargetSafePath(
  inputPath: string,
  ctx: ToolExecutionContext,
  label = 'Path',
  requestedRoot?: FileRootArg
): Promise<SafePath> {
  const base = chooseBaseRoot(inputPath, ctx, requestedRoot)
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base.root, inputPath)

  let realPath = resolvedPath
  try {
    realPath = await fs.realpath(resolvedPath)
  } catch {
    try {
      const parentDir = await fs.realpath(dirname(resolvedPath))
      realPath = join(parentDir, basename(resolvedPath))
    } catch {
      // Parent may not exist yet; containment checks can still use the resolved path.
    }
  }

  const rootInfo = getAccessibleRootForResolvedPath(realPath, ctx, requestedRoot)

  if (isSensitiveFile(realPath)) {
    throw new Error(`Security Violation: ${label} targets a sensitive file.`)
  }

  return {
    root: rootInfo.root,
    rootKind: rootInfo.rootKind,
    resolvedPath,
    realPath,
    relPath: relative(rootInfo.root, realPath).replace(/\\/g, '/')
  }
}

function assertNotProtectedWorkspacePath(root: string, realPath: string, label: string): void {
  const relPath = relative(root, realPath).replace(/\\/g, '/')
  if (!relPath || relPath === '.') {
    throw new Error(`${label} cannot be the selected root.`)
  }
  if (relPath === '.git' || relPath.startsWith('.git/')) {
    throw new Error(`${label} cannot target the .git directory.`)
  }
}

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

function normalizeNonNegativeLineArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
}

function normalizeSignedIntegerArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

function buildNumberedLines(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

function calculateReadWindow(
  args: ToolArgs,
  totalLines: number
): { startLine: number; endLine: number; mode: string; note?: string } {
  const requestedLimit = Math.min(normalizeLineNumberArg(args.limit, 1000), 2000)

  if (typeof args.tail === 'number' && Number.isFinite(args.tail)) {
    const tailLines = Math.min(Math.max(1, Math.floor(args.tail)), 2000)
    const startLine = Math.max(1, totalLines - tailLines + 1)
    return {
      startLine,
      endLine: totalLines,
      mode: 'tail',
      ...(tailLines !== Math.floor(args.tail)
        ? { note: `tail was clamped to ${tailLines} lines.` }
        : {})
    }
  }

  if (typeof args.around === 'number' && Number.isFinite(args.around)) {
    const aroundLine = Math.min(Math.max(1, Math.floor(args.around)), totalLines)
    const contextLines = Math.min(
      normalizeNonNegativeLineArg(args.context, normalizeNonNegativeLineArg(args.contextLines, 20)),
      500
    )
    const startLine = Math.max(1, aroundLine - contextLines)
    const endLine = Math.min(totalLines, aroundLine + contextLines)
    return {
      startLine,
      endLine,
      mode: 'around',
      ...(aroundLine !== Math.floor(args.around)
        ? { note: `around was clamped to line ${aroundLine}.` }
        : {})
    }
  }

  const rawOffset = normalizeSignedIntegerArg(args.offset, 1)
  const startLine =
    rawOffset < 0
      ? Math.max(1, totalLines + rawOffset + 1)
      : Math.min(Math.max(1, rawOffset), totalLines)
  const endLine = Math.min(totalLines, startLine + requestedLimit - 1)
  return {
    startLine,
    endLine,
    mode: rawOffset < 0 ? 'negative_offset' : 'offset'
  }
}

function getLineNumberAtPosition(text: string, position: number): number {
  return text.slice(0, Math.max(0, position)).split(/\r?\n/).length
}

function getLineEndForNeedle(startLine: number, needle: string): number {
  return startLine + needle.split(/\r?\n/).length - 1
}

function formatLineContext(lines: string[], centerLine: number, radius = 2): string {
  const start = Math.max(1, centerLine - radius)
  const end = Math.min(lines.length, centerLine + radius)
  const width = String(end).length
  const formatted: string[] = []

  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    const marker = lineNumber === centerLine ? '>' : ' '
    formatted.push(
      `${marker} ${String(lineNumber).padStart(width, ' ')} | ${lines[lineNumber - 1] ?? ''}`
    )
  }

  return formatted.join('\n')
}

function formatOccurrenceContexts(content: string, needle: string, occurrences: number[]): string {
  const lines = content.split(/\r?\n/)
  return occurrences
    .slice(0, 8)
    .map((position, index) => {
      const startLine = getLineNumberAtPosition(content, position)
      const endLine = getLineEndForNeedle(startLine, needle)
      return [
        `Match ${index + 1}: lines ${startLine}-${endLine}`,
        formatLineContext(lines, startLine, 2)
      ].join('\n')
    })
    .join('\n\n')
}

function getNeedlePreviewLine(needle: string): string {
  const lines = needle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (lines[0] || needle.trim()).slice(0, 80)
}

function formatClosestLineContexts(content: string, needle: string): string {
  const lines = content.split(/\r?\n/)
  const preview = getNeedlePreviewLine(needle)
  const probe = preview.slice(0, 30)
  if (!probe) return ''

  const contexts: string[] = []
  for (let i = 0; i < lines.length && contexts.length < 5; i++) {
    if (lines[i].includes(probe) || lines[i].trim().includes(probe.trim())) {
      contexts.push(
        `Candidate ${contexts.length + 1}: around line ${i + 1}\n${formatLineContext(lines, i + 1, 2)}`
      )
    }
  }

  return contexts.join('\n\n')
}

function formatEditLookupFailure(content: string, oldString: string): string {
  const lines = content.split(/\r?\n/)
  const oldLines = oldString.split(/\r?\n/).length
  const preview = getNeedlePreviewLine(oldString)
  const closest = formatClosestLineContexts(content, oldString)

  const details = [
    `Target preview: ${preview || '(empty after trimming)'}`,
    `Target length: ${oldString.length} chars across ${oldLines} line(s).`,
    `File length: ${lines.length} line(s).`,
    closest ? `Closest candidate contexts:\n${closest}` : '',
    'Tip: call file_read with around/lineNumbers near a candidate line, then retry with exact whitespace and surrounding context.'
  ]

  return details.filter(Boolean).join('\n')
}

function buildShortUnifiedDiff(before: string, after: string, maxChars = 12000): string {
  const diff = generateUnifiedDiff(before.split(/\r?\n/), after.split(/\r?\n/), 2)
  if (diff.length <= maxChars) return diff
  return `${diff.slice(0, maxChars)}\n\n[Diff truncated. Use file_diff or file_read around changed lines for more context.]`
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
        `^\\s*(?:[\\w:<>,~*&\\[\\]\\s]+\\s+)+${s}\\s*\\([^;]*\\)\\s*(?:const\\s*)?(?:\\{|$)`
      )
    }
  ]
}

function findSymbolMatchesInContent(
  content: string,
  symbol: string,
  target: Pick<SymbolMatch, 'realPath' | 'relPath' | 'root' | 'rootKind'>
): SymbolMatch[] {
  const patterns = buildSymbolDefinitionPatterns(symbol)
  const lines = content.split(/\r?\n/)
  const matches: SymbolMatch[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
  return line
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

async function scanWorkspaceForSymbol(
  symbol: string,
  ctx: ToolExecutionContext,
  requestedRoot?: FileRootArg
): Promise<{ matches: SymbolMatch[]; truncatedReason?: string }> {
  const rootInfo = chooseBaseRoot('.', ctx, requestedRoot)
  const root = rootInfo.root
  const matches: SymbolMatch[] = []
  const startTime = Date.now()
  const MAX_FILES = 2500
  const MAX_DIRS = 1200
  const SEARCH_TIMEOUT_MS = 10000
  let filesScanned = 0
  let dirsScanned = 0
  let truncatedReason: string | undefined

  const walk = async (dir: string): Promise<void> => {
    if (truncatedReason || ctx.signal.aborted) return
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
      const candidatePath = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (['.git', 'node_modules', 'dist', 'out', 'build', '.next'].includes(dirent.name)) {
          continue
        }
        await walk(candidatePath)
        continue
      }

      if (!dirent.isFile() || dirent.isSymbolicLink()) continue
      filesScanned++
      if (filesScanned > MAX_FILES) {
        truncatedReason = 'Maximum file scan limit reached'
        break
      }

      const ext = extname(dirent.name).toLowerCase()
      if (!CODE_SYMBOL_EXTENSIONS.has(ext)) continue
      if (!isPathInsideRoot(candidatePath, root) || isSensitiveFile(candidatePath)) continue

      try {
        const stats = await fs.stat(candidatePath)
        if (stats.size > 512 * 1024) continue
        const content = await fs.readFile(candidatePath, 'utf-8')
        matches.push(
          ...findSymbolMatchesInContent(content, symbol, {
            realPath: candidatePath,
            relPath: relative(root, candidatePath).replace(/\\/g, '/'),
            root,
            rootKind: rootInfo.rootKind
          })
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

export const fileTools: Record<string, ToolDefinition> = {
  file_read: {
    name: 'file_read',
    title: 'Read File',
    description:
      'Reads the content of a local file inside the global workspace or current project root. In project conversations, relative paths default to the project root.',
    tags: ['file', 'read', 'local', '文件', '读取', '内容', '读文件'],
    category: 'file',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The relative or absolute path to the file.' },
        root: ROOT_PARAMETER,
        offset: {
          type: 'number',
          description:
            'The 1-indexed line number to start reading from (default: 1). Negative values count back from the end: -1 reads from the last line, -100 reads from 100 lines before the end.'
        },
        limit: {
          type: 'number',
          description: 'The maximum number of lines to read (default: 1000).'
        },
        tail: {
          type: 'number',
          description:
            'Read the last N lines of the file. When provided, tail takes precedence over offset/limit.'
        },
        around: {
          type: 'number',
          description:
            'Read around this 1-indexed line number. When provided, returns around-context through around+context.'
        },
        context: {
          type: 'number',
          description:
            'Number of lines before and after around to include (default: 20). Alias contextLines is also accepted.'
        },
        contextLines: {
          type: 'number',
          description: 'Alias for context when using around.'
        },
        lineNumbers: {
          type: 'boolean',
          description:
            'Whether to prefix returned content lines with line numbers. Default false because numbered content is not suitable for exact string replacement.'
        }
      },
      required: ['path']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const filePath = args.path
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('Missing or invalid path parameter')
      }

      const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))

      try {
        const stats = await fs.stat(target.realPath)
        if (stats.isDirectory()) {
          throw new Error('Path is a directory, not a file.')
        }

        const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2MB
        if (stats.size > MAX_FILE_BYTES) {
          throw new Error(
            `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
          )
        }
      } catch (err) {
        const error = err as Error
        throw new Error(`Failed to read file: ${error.message}`)
      }

      let content = ''
      try {
        content = await fs.readFile(target.realPath, 'utf-8')
      } catch (err) {
        const error = err as Error
        throw new Error(`Failed to read file: ${error.message}`)
      }

      const lines = content.split(/\r?\n/)
      const totalLines = lines.length
      const window = calculateReadWindow(args, totalLines)
      const slicedLines = lines.slice(window.startLine - 1, window.endLine)
      const includeLineNumbers = args.lineNumbers === true
      const resultText = includeLineNumbers
        ? buildNumberedLines(slicedLines, window.startLine)
        : slicedLines.join('\n')

      const isTruncated = window.startLine > 1 || window.endLine < totalLines

      // Mark the file as observed so surgical edit tools (file_edit, multi_edit) can verify the
      // model has seen the content before mutating it. A partial read still counts as "seen".
      if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

      const resultForModel = [
        `Root (${target.rootKind}): ${target.root}`,
        `File: ${target.relPath}`,
        `Lines: ${window.startLine} to ${window.endLine} of ${totalLines}`,
        `Read Mode: ${window.mode}`,
        includeLineNumbers ? 'Line Numbers: included in content.' : '',
        window.note ? `Note: ${window.note}` : '',
        isTruncated ? 'Note: file content was truncated.' : '',
        `Content:\n${resultText}`
      ]
        .filter(Boolean)
        .join('\n\n')

      const fileUrl = `file:///${target.realPath.replace(/\\/g, '/')}`

      return {
        resultForModel,
        resultForUi: {
          title: `Read File: ${target.relPath}`,
          url: fileUrl,
          summary: `Read lines ${window.startLine}-${window.endLine} of ${totalLines} in ${target.rootKind} ${target.root}`
        }
      }
    }
  },
  code_symbol_read: {
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
      const block = lines.slice(range.startIndex, range.endIndex + 1).join('\n')
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
        `Content:\n${block}`
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
  },
  ...createFileSearchTools({
    rootParameter: ROOT_PARAMETER,
    getRootArg,
    chooseBaseRoot,
    isPathInsideRoot
  }),
  file_write: {
    name: 'file_write',
    title: 'Write File',
    description:
      'Writes content to a local file. Files inside the workspace are written directly, while files outside the workspace require user approval.',
    tags: [
      'file',
      'write',
      'local',
      'save',
      '文件',
      '写入',
      '保存',
      '修改',
      '编辑',
      '创建',
      '翻译'
    ],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative or absolute path to write the file to.'
        },
        root: ROOT_PARAMETER,
        content: {
          type: 'string',
          description: 'The file content to write.'
        },
        mode: {
          type: 'string',
          description:
            'Whether to fail if file exists ("create") or overwrite ("overwrite"). (default: "create")',
          enum: ['create', 'overwrite']
        },
        createDirs: {
          type: 'boolean',
          description:
            'Whether to automatically create parent directories if they do not exist. (default: true)'
        }
      },
      required: ['path', 'content']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const filePath = args.path
      const content = args.content
      const mode = (args.mode as string) || 'create'
      const createDirs = args.createDirs !== false

      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('Missing or invalid path parameter')
      }
      if (typeof content !== 'string') {
        throw new Error('Missing or invalid content parameter')
      }

      const target = await resolveTargetSafePath(filePath, ctx, 'Path', getRootArg(args))
      console.log(`[file_write] ${target.rootKind} root is: ${target.root}`)

      const MAX_WRITE_BYTES = 2 * 1024 * 1024
      const contentBuffer = Buffer.from(content, 'utf-8')
      if (contentBuffer.length > MAX_WRITE_BYTES) {
        throw new Error(
          `File content is too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported write size is 2 MB.`
        )
      }

      let exists = false
      try {
        const stats = await fs.stat(target.realPath)
        exists = true
        if (stats.isDirectory()) {
          throw new Error('Target path is a directory, not a file.')
        }
      } catch {
        // If file doesn't exist, stat throws ENOENT, which is expected
      }

      if (exists && mode === 'create') {
        throw new Error(
          `File already exists and mode is set to "create". To overwrite, set mode to "overwrite".`
        )
      }

      try {
        if (createDirs) {
          const parent = dirname(target.realPath)
          await fs.mkdir(parent, { recursive: true })
        }
        await fs.writeFile(target.realPath, content, 'utf-8')
      } catch (err) {
        const error = err as Error
        throw new Error(`Failed to write file: ${error.message}`)
      }

      const fileUrl = `file:///${target.realPath.replace(/\\/g, '/')}`

      // Writing establishes known content, so subsequent surgical edits in this run are allowed.
      if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

      const resultForModel = `Successfully wrote file: ${target.relPath}\nRoot (${target.rootKind}): ${target.root}\nSize: ${contentBuffer.length} bytes\nPath: ${target.realPath}`

      return {
        resultForModel,
        resultForUi: {
          title: `Write File: ${target.relPath}`,
          url: fileUrl,
          summary: `Wrote ${contentBuffer.length} bytes to ${target.relPath} (${exists ? 'overwrote' : 'created'}) in ${target.rootKind} ${target.root}`
        }
      }
    }
  },
  file_edit: {
    name: 'file_edit',
    title: 'Edit File',
    description:
      'Performs exact string replacement in a file. Files inside the workspace are edited directly, while files outside the workspace require user approval. Provide the exact text to replace (old_string) and the new text (new_string). By default, old_string must match exactly one location — if it matches multiple locations the edit is rejected with a list of matching lines so you can add more surrounding context to make it unique. Use replace_all=true to replace every occurrence.',
    tags: [
      'file',
      'edit',
      'replace',
      'patch',
      'modify',
      'update',
      '文件',
      '编辑',
      '替换',
      '修改',
      '更新'
    ],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative or absolute path to the file to edit.'
        },
        root: ROOT_PARAMETER,
        old_string: {
          type: 'string',
          description:
            'The exact text to replace. Must match exactly (whitespace, indentation, newlines all count). If multiple matches exist, the edit is rejected unless replace_all is true.'
        },
        new_string: {
          type: 'string',
          description: 'The replacement text (must be different from old_string).'
        },
        replace_all: {
          type: 'boolean',
          description:
            'Replace all occurrences of old_string (default false). When false, old_string must match exactly one location.'
        }
      },
      required: ['path', 'old_string', 'new_string']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const filePath = args.path
      const oldString = args.old_string
      const newString = args.new_string
      const replaceAll = args.replace_all === true

      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('Missing or invalid path parameter')
      }
      if (typeof oldString !== 'string') {
        throw new Error('Missing or invalid old_string parameter')
      }
      if (typeof newString !== 'string') {
        throw new Error('Missing or invalid new_string parameter')
      }
      if (oldString === newString) {
        throw new Error('old_string and new_string must be different')
      }
      if (!oldString) {
        throw new Error('old_string must not be empty')
      }

      const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))

      const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
      if (runCtx && !runCtx.hasSeenFile(target.realPath)) {
        throw new Error(
          'You must read this file before editing it. Call file_read on this path first so the edit is based on its current content, then retry file_edit.'
        )
      }

      let content: string
      try {
        content = await fs.readFile(target.realPath, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to read file: ${(err as Error).message}`)
      }

      // Count occurrences
      const occurrences: number[] = []
      let searchFrom = 0
      while (searchFrom < content.length) {
        const idx = content.indexOf(oldString, searchFrom)
        if (idx === -1) break
        occurrences.push(idx)
        searchFrom = idx + 1
      }

      if (occurrences.length === 0) {
        throw new Error(
          `old_string not found in file.\n${formatEditLookupFailure(content, oldString)}`
        )
      }

      if (!replaceAll && occurrences.length > 1) {
        throw new Error(
          `old_string matched ${occurrences.length} locations. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${formatOccurrenceContexts(content, oldString, occurrences)}`
        )
      }

      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.slice(0, occurrences[0]) +
          newString +
          content.slice(occurrences[0] + oldString.length)

      const newBuffer = Buffer.from(newContent, 'utf-8')
      const MAX_BYTES = 2 * 1024 * 1024
      if (newBuffer.length > MAX_BYTES) {
        throw new Error(
          `Resulting file is too large (${(newBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`
        )
      }

      try {
        await fs.writeFile(target.realPath, newContent, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to write file: ${(err as Error).message}`)
      }

      // Content is now known after the edit; keep the file marked as seen for follow-up edits.
      runCtx?.markFileSeen(target.realPath)

      const count = replaceAll ? occurrences.length : 1
      const diff = buildShortUnifiedDiff(content, newContent)

      return {
        resultForModel: `Successfully edited ${target.relPath}: replaced ${count} occurrence(s).\nRoot (${target.rootKind}): ${target.root}\n\nDiff:\n${diff}`,
        resultForUi: {
          title: `Edit File: ${target.relPath}`,
          summary: `Replaced ${count} occurrence(s) in ${target.relPath}`
        }
      }
    }
  },
  multi_edit: {
    name: 'multi_edit',
    title: 'Multi-Edit File',
    description:
      'Applies a sequence of exact string replacements to a single file in one atomic operation. Edits are applied in order, each operating on the result of the previous one. If ANY edit fails (old_string not found, or matches multiple locations without replace_all), NO changes are written and the file is left untouched. Prefer this over multiple file_edit calls when changing several places in the same file. The file must have been read earlier in this run. Each edit takes { old_string, new_string, replace_all? }; old_string must be unique unless replace_all is true, and must differ from new_string.',
    tags: [
      'file',
      'edit',
      'multi',
      'batch',
      'replace',
      'patch',
      'atomic',
      '文件',
      '编辑',
      '批量',
      '替换',
      '修改',
      '更新'
    ],
    dependencies: ['file_read'],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative or absolute path to the file to edit.'
        },
        root: ROOT_PARAMETER,
        edits: {
          type: 'array',
          description:
            'Ordered list of edits to apply. Each item is an object with "old_string" (exact text to find), "new_string" (replacement), and optional "replace_all" (boolean). Edits apply sequentially; each sees the result of the previous one.',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: 'Exact text to replace.' },
              new_string: { type: 'string', description: 'Replacement text.' },
              replace_all: {
                type: 'boolean',
                description: 'Replace all occurrences of old_string (default false).'
              }
            },
            required: ['old_string', 'new_string']
          }
        }
      },
      required: ['path', 'edits']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const filePath = args.path
      const rawEdits = args.edits

      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('Missing or invalid path parameter')
      }
      if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
        throw new Error('edits must be a non-empty array')
      }

      interface EditOp {
        oldString: string
        newString: string
        replaceAll: boolean
      }
      const edits: EditOp[] = rawEdits.map((raw, i) => {
        const e = raw as Record<string, unknown>
        const oldString = e.old_string
        const newString = e.new_string
        const replaceAll = e.replace_all === true
        if (typeof oldString !== 'string' || !oldString) {
          throw new Error(`edits[${i}]: old_string must be a non-empty string`)
        }
        if (typeof newString !== 'string') {
          throw new Error(`edits[${i}]: new_string must be a string`)
        }
        if (oldString === newString) {
          throw new Error(`edits[${i}]: old_string and new_string must be different`)
        }
        return { oldString, newString, replaceAll }
      })

      const target = await resolveExistingSafePath(filePath, ctx, 'Path', getRootArg(args))

      const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
      if (runCtx && !runCtx.hasSeenFile(target.realPath)) {
        throw new Error(
          'You must read this file before editing it. Call file_read on this path first so the edits are based on its current content, then retry multi_edit.'
        )
      }

      let content: string
      try {
        content = await fs.readFile(target.realPath, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to read file: ${(err as Error).message}`)
      }

      // Apply all edits in memory first. Only write if every edit succeeds (atomic).
      let working = content
      let totalReplacements = 0
      for (let i = 0; i < edits.length; i++) {
        const { oldString, newString, replaceAll } = edits[i]

        const occurrences: number[] = []
        let searchFrom = 0
        while (searchFrom < working.length) {
          const idx = working.indexOf(oldString, searchFrom)
          if (idx === -1) break
          occurrences.push(idx)
          searchFrom = idx + 1
        }

        if (occurrences.length === 0) {
          throw new Error(
            `edits[${i}]: old_string not found. No changes were written.\n${formatEditLookupFailure(working, oldString)}\nTip: a previous edit in this batch may have already changed the surrounding text. Each old_string must match the file state after earlier edits.`
          )
        }
        if (!replaceAll && occurrences.length > 1) {
          throw new Error(
            `edits[${i}]: old_string matched ${occurrences.length} locations. No changes were written. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${formatOccurrenceContexts(working, oldString, occurrences)}`
          )
        }

        working = replaceAll
          ? working.split(oldString).join(newString)
          : working.slice(0, occurrences[0]) +
            newString +
            working.slice(occurrences[0] + oldString.length)
        totalReplacements += replaceAll ? occurrences.length : 1
      }

      const newBuffer = Buffer.from(working, 'utf-8')
      const MAX_BYTES = 2 * 1024 * 1024
      if (newBuffer.length > MAX_BYTES) {
        throw new Error(
          `Resulting file is too large (${(newBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB. No changes were written.`
        )
      }

      try {
        await fs.writeFile(target.realPath, working, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to write file: ${(err as Error).message}`)
      }

      runCtx?.markFileSeen(target.realPath)
      const diff = buildShortUnifiedDiff(content, working)

      return {
        resultForModel: `Successfully applied ${edits.length} edit(s) to ${target.relPath}: ${totalReplacements} total replacement(s).\nRoot (${target.rootKind}): ${target.root}\n\nDiff:\n${diff}`,
        resultForUi: {
          title: `Multi-Edit File: ${target.relPath}`,
          summary: `Applied ${edits.length} edit(s) (${totalReplacements} replacement(s)) in ${target.relPath}`
        }
      }
    }
  },
  ...createFileOperationTools({
    rootParameter: ROOT_PARAMETER,
    getRootArg,
    getNamedRootArg,
    normalizeComparablePath,
    resolveExistingSafePath,
    resolveTargetSafePath,
    assertNotProtectedWorkspacePath
  }),
  file_diff: createFileDiffTool({
    rootParameter: ROOT_PARAMETER,
    getRootArg,
    getNamedRootArg,
    resolveExistingSafePath
  })
}
