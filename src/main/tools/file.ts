import { resolve, relative, join, dirname, basename, isAbsolute } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import {
  getWorkspaceRoot,
  isSensitiveFile,
  escapeRegExp,
  SEARCH_IGNORE_EXTENSIONS
} from './helpers'

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
          description: 'The 1-indexed line number to start reading from (default: 1).'
        },
        limit: {
          type: 'number',
          description: 'The maximum number of lines to read (default: 1000).'
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

      const offset = typeof args.offset === 'number' ? Math.max(1, args.offset) : 1
      const limit = typeof args.limit === 'number' ? Math.max(1, args.limit) : 1000
      const maxLines = Math.min(limit, 2000)

      const lines = content.split(/\r?\n/)
      const slicedLines = lines.slice(offset - 1, offset - 1 + maxLines)
      const resultText = slicedLines.join('\n')

      const totalLines = lines.length
      const isTruncated = offset - 1 + maxLines < totalLines

      // Mark the file as observed so surgical edit tools (file_edit, multi_edit) can verify the
      // model has seen the content before mutating it. A partial read still counts as "seen".
      if (ctx.reqId) getRun(ctx.reqId)?.markFileSeen(target.realPath)

      const resultForModel = [
        `Root (${target.rootKind}): ${target.root}`,
        `File: ${target.relPath}`,
        `Lines: ${offset} to ${offset - 1 + slicedLines.length} of ${totalLines}`,
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
          summary: `Read lines ${offset}-${offset - 1 + slicedLines.length} of ${totalLines} in ${target.rootKind} ${target.root}`
        }
      }
    }
  },
  workspace_search: {
    name: 'workspace_search',
    title: 'Workspace Search',
    description:
      'Search for text matches within files in the global workspace or current project root (skipping build/dependency folders). In project conversations, relative paths default to the project root.',
    tags: ['file', 'search', 'grep', 'local', 'find', '搜索', '查找', '全局', '工作区', '内容'],
    dependencies: ['file_read'],
    category: 'file',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text query to search for.' },
        root: ROOT_PARAMETER,
        glob: {
          type: 'string',
          description: 'Optional glob pattern to filter files (e.g., "*.ts" or "src/**/*.tsx").'
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Whether the search is case-sensitive (default: false).'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of match results to return (default: 100).'
        }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const query = args.query
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }

      const globPattern = typeof args.glob === 'string' ? args.glob : undefined
      const caseSensitive = typeof args.caseSensitive === 'boolean' ? args.caseSensitive : false
      const maxResults = typeof args.maxResults === 'number' ? Math.max(1, args.maxResults) : 100
      const limit = Math.min(maxResults, 500)

      const rootInfo = chooseBaseRoot('.', ctx, getRootArg(args))
      const root = rootInfo.root
      console.log(`[workspace_search] Search root is: ${root}`)

      const MAX_FILES_SCANNED = 5000
      const MAX_DIRS_SCANNED = 1000
      const SEARCH_TIMEOUT_MS = 10000

      let filesScanned = 0
      let dirsScanned = 0
      const startTime = Date.now()
      let scanTruncatedReason: string | undefined = undefined

      const searchRegex = new RegExp(escapeRegExp(query), caseSensitive ? '' : 'i')

      let globRegex: RegExp | undefined = undefined
      if (globPattern) {
        const GLOBSTAR = '__GLOBSTAR__'
        let pattern = globPattern.replace(/\*\*/g, GLOBSTAR)
        pattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        pattern = pattern.replace(/\*/g, '[^/]*')
        pattern = pattern.replace(/\?/g, '[^/]')
        pattern = pattern.replace(new RegExp(GLOBSTAR + '/', 'g'), '(?:.*/)?')
        pattern = pattern.replace(new RegExp(GLOBSTAR, 'g'), '.*')
        globRegex = new RegExp(
          globPattern.includes('/')
            ? '^' + pattern + '$'
            : '/' + pattern + '$|' + '^' + pattern + '$',
          'i'
        )
      }

      const matches: Array<{
        relativePath: string
        absolutePath: string
        lineNumber: number
        lineContent: string
        contextBefore: string[]
        contextAfter: string[]
      }> = []

      const walk = async (dir: string): Promise<void> => {
        if (ctx.signal.aborted || scanTruncatedReason) return

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
          if (matches.length >= limit || scanTruncatedReason || ctx.signal.aborted) break
          const resPath = join(dir, dirent.name)
          const relPath = relative(root, resPath)

          if (dirent.isDirectory()) {
            if (['.git', 'node_modules', 'dist', 'out', 'build'].includes(dirent.name)) {
              continue
            }
            await walk(resPath)
          } else {
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

            if (!isPathInsideRoot(resPath, root) || isSensitiveFile(resPath)) {
              continue
            }

            const lowerName = dirent.name.toLowerCase()
            if (SEARCH_IGNORE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
              continue
            }

            const MAX_SEARCH_FILE_BYTES = 512 * 1024
            try {
              const stats = await fs.stat(resPath)
              if (stats.size > MAX_SEARCH_FILE_BYTES) continue
            } catch {
              continue
            }

            try {
              const content = await fs.readFile(resPath, 'utf-8')
              const lines = content.split(/\r?\n/)
              const MAX_LINE_LEN = 300
              const truncLine = (l: string): string =>
                l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) + '...' : l
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= limit || scanTruncatedReason || ctx.signal.aborted) break
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
              // Ignore unreadable/binary files
            }
          }
        }
      }

      await walk(root)

      if (ctx.signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      let resultForModel = [
        `Root (${rootInfo.rootKind}): ${root}`,
        matches.length > 0
          ? matches
              .map((m) => {
                const contextStr = [
                  ...m.contextBefore.map((l) => `  [${m.lineNumber - 1}] ${l}`),
                  `* [${m.lineNumber}] ${m.lineContent}`,
                  ...m.contextAfter.map((l) => `  [${m.lineNumber + 1}] ${l}`)
                ].join('\n')
                return `File: ${m.relativePath} (Line ${m.lineNumber})\nContext:\n${contextStr}`
              })
              .join('\n\n')
          : `No matches found in workspace for query: "${query}"`
      ].join('\n\n')

      if (scanTruncatedReason) {
        resultForModel += `\n\n[Warning: Search scan was truncated. Reason: ${scanTruncatedReason}]`
      }

      const MAX_RESULT_LEN = 25000
      if (resultForModel.length > MAX_RESULT_LEN) {
        resultForModel =
          resultForModel.slice(0, MAX_RESULT_LEN) +
          '\n\n[Results truncated. Refine your query or use glob to narrow the search.]'
      }

      const items = matches.map((m) => {
        const fileUrl = `file:///${m.absolutePath.replace(/\\/g, '/')}`
        const contextStr = [
          ...m.contextBefore.map((l) => `[${m.lineNumber - 1}] ${l}`),
          `[${m.lineNumber}] ${m.lineContent}`,
          ...m.contextAfter.map((l) => `[${m.lineNumber + 1}] ${l}`)
        ].join('\n')

        return {
          title: `${m.relativePath} Line ${m.lineNumber}`,
          url: fileUrl,
          snippet: contextStr,
          source: 'Workspace'
        }
      })

      const summaryText =
        `Found ${matches.length} matches in ${root}` +
        (scanTruncatedReason ? ` (Scan truncated: ${scanTruncatedReason})` : '')

      return {
        resultForModel,
        resultForUi: {
          title: `Workspace Search: "${query}"`,
          summary: summaryText,
          items
        }
      }
    }
  },
  workspace_list_files: {
    name: 'workspace_list_files',
    title: 'List Workspace Files',
    description:
      'Lists files matching a glob wildcard pattern within the global workspace or current project root. In project conversations, relative paths default to the project root.',
    tags: [
      'file',
      'list',
      'glob',
      'find',
      'local',
      '列表',
      '文件',
      '查找',
      '工作区',
      '列出',
      'markdown',
      'md',
      'batch',
      'translate',
      'path'
    ],
    dependencies: ['file_read', 'file_write'],
    category: 'file',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description: 'The glob pattern to filter files (e.g., "**/*.md" or "src/**/*.ts").'
        },
        root: ROOT_PARAMETER,
        maxResults: {
          type: 'number',
          description: 'Maximum number of file paths to return (default: 100).'
        }
      },
      required: ['glob']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const globPattern = args.glob
      if (typeof globPattern !== 'string' || !globPattern) {
        throw new Error('Missing or invalid glob parameter')
      }

      const maxResults = typeof args.maxResults === 'number' ? Math.max(1, args.maxResults) : 100
      const limit = Math.min(maxResults, 1000)

      const rootInfo = chooseBaseRoot('.', ctx, getRootArg(args))
      const root = rootInfo.root
      console.log(`[workspace_list_files] List root is: ${root}`)

      const MAX_FILES_SCANNED = 5000
      const MAX_DIRS_SCANNED = 1000
      const SEARCH_TIMEOUT_MS = 10000

      let filesScanned = 0
      let dirsScanned = 0
      const startTime = Date.now()
      let scanTruncatedReason: string | undefined = undefined

      const GLOBSTAR = '__GLOBSTAR__'
      let pattern = globPattern.replace(/\*\*/g, GLOBSTAR)
      pattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      pattern = pattern.replace(/\*/g, '[^/]*')
      pattern = pattern.replace(/\?/g, '[^/]')
      pattern = pattern.replace(new RegExp(GLOBSTAR + '/', 'g'), '(?:.*/)?')
      pattern = pattern.replace(new RegExp(GLOBSTAR, 'g'), '.*')
      const globRegex = new RegExp(
        globPattern.includes('/')
          ? '^' + pattern + '$'
          : '/' + pattern + '$|' + '^' + pattern + '$',
        'i'
      )

      const matches: Array<{
        relativePath: string
        absolutePath: string
        size: number
        modifiedTime: string
      }> = []

      const walk = async (dir: string): Promise<void> => {
        if (ctx.signal.aborted || scanTruncatedReason) return

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
          if (matches.length >= limit || scanTruncatedReason || ctx.signal.aborted) break
          const resPath = join(dir, dirent.name)
          const relPath = relative(root, resPath)

          if (dirent.isDirectory()) {
            if (['.git', 'node_modules', 'dist', 'out', 'build'].includes(dirent.name)) {
              continue
            }
            await walk(resPath)
          } else {
            filesScanned++
            if (filesScanned > MAX_FILES_SCANNED) {
              scanTruncatedReason = 'Maximum file scan limit reached'
              break
            }

            if (dirent.isSymbolicLink()) continue

            const normalizedRelPath = relPath.replace(/\\/g, '/')
            if (!globRegex.test(normalizedRelPath)) {
              continue
            }

            if (!isPathInsideRoot(resPath, root) || isSensitiveFile(resPath)) {
              continue
            }

            try {
              const stats = await fs.stat(resPath)
              matches.push({
                relativePath: relPath.replace(/\\/g, '/'),
                absolutePath: resPath,
                size: stats.size,
                modifiedTime: stats.mtime.toISOString()
              })
            } catch {
              // Ignore files we cannot stat
            }
          }
        }
      }

      await walk(root)

      if (ctx.signal.aborted) {
        throw new Error('Agent execution aborted by user.')
      }

      let resultForModel = [
        `Root (${rootInfo.rootKind}): ${root}`,
        matches.length > 0
          ? matches
              .map(
                (m) => `File: ${m.relativePath}\nSize: ${m.size} bytes\nModified: ${m.modifiedTime}`
              )
              .join('\n\n')
          : `No files found matching glob: "${globPattern}"`
      ].join('\n\n')

      if (scanTruncatedReason) {
        resultForModel += `\n\n[Warning: Scan was truncated. Reason: ${scanTruncatedReason}]`
      }

      const items = matches.map((m) => {
        const fileUrl = `file:///${m.absolutePath.replace(/\\/g, '/')}`
        return {
          title: m.relativePath,
          url: fileUrl,
          snippet: `Size: ${m.size} bytes, Modified: ${m.modifiedTime}`,
          source: 'Workspace'
        }
      })

      const summaryText =
        `Found ${matches.length} files in ${root}` +
        (scanTruncatedReason ? ` (Scan truncated: ${scanTruncatedReason})` : '')

      return {
        resultForModel,
        resultForUi: {
          title: `List Files: "${globPattern}"`,
          summary: summaryText,
          items
        }
      }
    }
  },
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
        // Collect the closest lines to help AI debug mismatches
        const contentLines = content.split(/\r?\n/)
        const needleLines = oldString.split(/\r?\n/)
        const firstNeedleLine = needleLines[0].trim()
        const closeMatches: string[] = []
        for (let i = 0; i < contentLines.length && closeMatches.length < 5; i++) {
          if (contentLines[i].trim().includes(firstNeedleLine.slice(0, 20))) {
            closeMatches.push(`  Line ${i + 1}: ${contentLines[i].trim().slice(0, 120)}`)
          }
        }
        const hint =
          closeMatches.length > 0
            ? `\nClosest matching lines:\n${closeMatches.join('\n')}\nTip: check indentation, trailing whitespace, and line endings. Use file_read to verify the exact content.`
            : '\nTip: use file_read to verify the exact file content including whitespace.'
        throw new Error(`old_string not found in file.${hint}`)
      }

      if (!replaceAll && occurrences.length > 1) {
        const lines = content.split(/\r?\n/)
        const matchLines: string[] = []
        for (const pos of occurrences) {
          const lineNum = content.slice(0, pos).split(/\r?\n/).length
          matchLines.push(`  Line ${lineNum}: ${lines[lineNum - 1]?.trim().slice(0, 120) || ''}`)
        }
        throw new Error(
          `old_string matched ${occurrences.length} locations. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${matchLines.join('\n')}`
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

      return {
        resultForModel: `Successfully edited ${target.relPath}: replaced ${count} occurrence(s).\nRoot (${target.rootKind}): ${target.root}`,
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
            `edits[${i}]: old_string not found. No changes were written. Tip: a previous edit in this batch may have already changed the surrounding text — make sure each old_string matches the file state after earlier edits, and check whitespace/indentation.`
          )
        }
        if (!replaceAll && occurrences.length > 1) {
          const lines = working.split(/\r?\n/)
          const matchLines: string[] = []
          for (const pos of occurrences) {
            const lineNum = working.slice(0, pos).split(/\r?\n/).length
            matchLines.push(`  Line ${lineNum}: ${lines[lineNum - 1]?.trim().slice(0, 120) || ''}`)
          }
          throw new Error(
            `edits[${i}]: old_string matched ${occurrences.length} locations. No changes were written. Add more surrounding context to make it unique, or set replace_all=true.\nMatch locations:\n${matchLines.join('\n')}`
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

      return {
        resultForModel: `Successfully applied ${edits.length} edit(s) to ${target.relPath}: ${totalReplacements} total replacement(s).\nRoot (${target.rootKind}): ${target.root}`,
        resultForUi: {
          title: `Multi-Edit File: ${target.relPath}`,
          summary: `Applied ${edits.length} edit(s) (${totalReplacements} replacement(s)) in ${target.relPath}`
        }
      }
    }
  },
  directory_create: {
    name: 'directory_create',
    title: 'Create Directory',
    description:
      'Creates a directory within the workspace. Parent directories are created by default.',
    tags: ['file', 'directory', 'mkdir', 'create', 'folder', 'workspace'],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create, relative to the workspace or absolute.'
        },
        root: ROOT_PARAMETER,
        recursive: {
          type: 'boolean',
          description: 'Whether to create parent directories as needed. Defaults to true.'
        }
      },
      required: ['path']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const dirPath = args.path
      if (typeof dirPath !== 'string' || !dirPath) {
        throw new Error('Missing or invalid path parameter')
      }

      const recursive = args.recursive !== false
      const target = await resolveTargetSafePath(dirPath, ctx, 'Directory path', getRootArg(args))
      assertNotProtectedWorkspacePath(target.root, target.realPath, 'Directory path')

      try {
        await fs.mkdir(target.realPath, { recursive })
      } catch (err) {
        throw new Error(`Failed to create directory: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Created directory: ${target.relPath}\nPath: ${target.realPath}`,
        resultForUi: {
          title: `Create Directory: ${target.relPath}`,
          url: `file:///${target.realPath.replace(/\\/g, '/')}`,
          summary: `Created directory ${target.relPath}`
        }
      }
    }
  },
  file_copy: {
    name: 'file_copy',
    title: 'Copy File',
    description:
      'Copies a file within the workspace. Directory copying is not supported; use this for individual files.',
    tags: ['file', 'copy', 'duplicate', 'workspace'],
    category: 'file',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Source file path, relative to the workspace or absolute.'
        },
        sourceRoot: ROOT_PARAMETER,
        destinationPath: {
          type: 'string',
          description: 'Destination file path, relative to the workspace or absolute.'
        },
        destinationRoot: ROOT_PARAMETER,
        root: ROOT_PARAMETER,
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing destination file. Defaults to false.'
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to create destination parent directories. Defaults to true.'
        }
      },
      required: ['sourcePath', 'destinationPath']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const sourcePath = args.sourcePath
      const destinationPath = args.destinationPath
      if (typeof sourcePath !== 'string' || !sourcePath) {
        throw new Error('Missing or invalid sourcePath parameter')
      }
      if (typeof destinationPath !== 'string' || !destinationPath) {
        throw new Error('Missing or invalid destinationPath parameter')
      }

      const overwrite = args.overwrite === true
      const createDirs = args.createDirs !== false
      const source = await resolveExistingSafePath(
        sourcePath,
        ctx,
        'Source path',
        getNamedRootArg(args, 'sourceRoot') || getRootArg(args)
      )
      const destination = await resolveTargetSafePath(
        destinationPath,
        ctx,
        'Destination path',
        getNamedRootArg(args, 'destinationRoot') || getRootArg(args)
      )
      assertNotProtectedWorkspacePath(source.root, source.realPath, 'Source path')
      assertNotProtectedWorkspacePath(destination.root, destination.realPath, 'Destination path')

      const sourceStats = await fs.stat(source.realPath)
      if (sourceStats.isDirectory()) {
        throw new Error('Source path is a directory. file_copy supports files only.')
      }

      try {
        const destinationStats = await fs.stat(destination.realPath)
        if (destinationStats.isDirectory()) {
          throw new Error('Destination path is an existing directory.')
        }
        if (!overwrite) {
          throw new Error('Destination file already exists. Set overwrite=true to replace it.')
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw err
      }

      try {
        if (createDirs) {
          await fs.mkdir(dirname(destination.realPath), { recursive: true })
        }
        await fs.copyFile(source.realPath, destination.realPath)
      } catch (err) {
        throw new Error(`Failed to copy file: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Copied file:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
        resultForUi: {
          title: `Copy File: ${source.relPath}`,
          url: `file:///${destination.realPath.replace(/\\/g, '/')}`,
          summary: `Copied ${source.relPath} to ${destination.relPath}`
        }
      }
    }
  },
  file_move: {
    name: 'file_move',
    title: 'Move File or Directory',
    description:
      'Moves or renames a file or directory within the workspace. Refuses to overwrite unless overwrite=true.',
    tags: ['file', 'move', 'rename', 'directory', 'workspace'],
    category: 'file',
    risk: 'high',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Source path to move, relative to the workspace or absolute.'
        },
        sourceRoot: ROOT_PARAMETER,
        destinationPath: {
          type: 'string',
          description: 'Destination path, relative to the workspace or absolute.'
        },
        destinationRoot: ROOT_PARAMETER,
        root: ROOT_PARAMETER,
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing destination file. Defaults to false.'
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to create destination parent directories. Defaults to true.'
        }
      },
      required: ['sourcePath', 'destinationPath']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const sourcePath = args.sourcePath
      const destinationPath = args.destinationPath
      if (typeof sourcePath !== 'string' || !sourcePath) {
        throw new Error('Missing or invalid sourcePath parameter')
      }
      if (typeof destinationPath !== 'string' || !destinationPath) {
        throw new Error('Missing or invalid destinationPath parameter')
      }

      const overwrite = args.overwrite === true
      const createDirs = args.createDirs !== false
      const source = await resolveExistingSafePath(
        sourcePath,
        ctx,
        'Source path',
        getNamedRootArg(args, 'sourceRoot') || getRootArg(args)
      )
      const destination = await resolveTargetSafePath(
        destinationPath,
        ctx,
        'Destination path',
        getNamedRootArg(args, 'destinationRoot') || getRootArg(args)
      )
      assertNotProtectedWorkspacePath(source.root, source.realPath, 'Source path')
      assertNotProtectedWorkspacePath(destination.root, destination.realPath, 'Destination path')

      const sourceComparable = normalizeComparablePath(source.realPath)
      const destinationComparable = normalizeComparablePath(destination.realPath)
      if (sourceComparable === destinationComparable) {
        throw new Error('Source and destination are the same path.')
      }
      if (destinationComparable.startsWith(`${sourceComparable}/`)) {
        throw new Error('Destination cannot be inside the source path.')
      }

      try {
        const destinationStats = await fs.stat(destination.realPath)
        if (destinationStats.isDirectory()) {
          throw new Error('Destination path is an existing directory.')
        }
        if (!overwrite) {
          throw new Error(
            'Destination path already exists. Set overwrite=true to replace an existing file.'
          )
        }
        await fs.rm(destination.realPath, { force: false })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw err
      }

      try {
        if (createDirs) {
          await fs.mkdir(dirname(destination.realPath), { recursive: true })
        }
        await fs.rename(source.realPath, destination.realPath)
      } catch (err) {
        throw new Error(`Failed to move path: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Moved path:\nFrom: ${source.relPath}\nTo: ${destination.relPath}`,
        resultForUi: {
          title: `Move Path: ${source.relPath}`,
          url: `file:///${destination.realPath.replace(/\\/g, '/')}`,
          summary: `Moved ${source.relPath} to ${destination.relPath}`
        }
      }
    }
  },
  file_delete: {
    name: 'file_delete',
    title: 'Delete File or Directory',
    description:
      'Deletes a file or, when recursive=true, a directory within the workspace. Refuses to delete the workspace root or .git directory.',
    tags: ['file', 'delete', 'remove', 'rm', 'directory', 'workspace'],
    category: 'file',
    risk: 'high',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to delete, relative to the workspace or absolute.'
        },
        root: ROOT_PARAMETER,
        recursive: {
          type: 'boolean',
          description: 'Required to delete directories. Defaults to false.'
        }
      },
      required: ['path']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const targetPath = args.path
      if (typeof targetPath !== 'string' || !targetPath) {
        throw new Error('Missing or invalid path parameter')
      }

      const recursive = args.recursive === true
      const target = await resolveExistingSafePath(targetPath, ctx, 'Delete path', getRootArg(args))
      assertNotProtectedWorkspacePath(target.root, target.realPath, 'Delete path')

      const stats = await fs.stat(target.realPath)
      if (stats.isDirectory() && !recursive) {
        throw new Error('Delete path is a directory. Set recursive=true to delete directories.')
      }

      try {
        await fs.rm(target.realPath, { recursive, force: false })
      } catch (err) {
        throw new Error(`Failed to delete path: ${(err as Error).message}`)
      }

      return {
        resultForModel: `Deleted path: ${target.relPath}`,
        resultForUi: {
          title: `Delete Path: ${target.relPath}`,
          summary: `Deleted ${target.relPath}`
        }
      }
    }
  },
  file_diff: {
    name: 'file_diff',
    title: 'Compare Files',
    description:
      'Compares two files and returns a unified line-by-line diff. Files within the workspace are read directly, while files outside the workspace require user approval.',
    tags: ['file', 'diff', 'compare', 'difference', '文件', '对比', '差异'],
    category: 'file',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path_a: {
          type: 'string',
          description: 'The relative or absolute path to the first file.'
        },
        root_a: ROOT_PARAMETER,
        path_b: {
          type: 'string',
          description: 'The relative or absolute path to the second file.'
        },
        root_b: ROOT_PARAMETER,
        root: ROOT_PARAMETER
      },
      required: ['path_a', 'path_b']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const filePathA = args.path_a
      const filePathB = args.path_b

      if (typeof filePathA !== 'string' || !filePathA) {
        throw new Error('Missing or invalid path_a parameter')
      }
      if (typeof filePathB !== 'string' || !filePathB) {
        throw new Error('Missing or invalid path_b parameter')
      }

      const pathA = await resolveExistingSafePath(
        filePathA,
        ctx,
        'Path_A',
        getNamedRootArg(args, 'root_a') || getRootArg(args)
      )
      const pathB = await resolveExistingSafePath(
        filePathB,
        ctx,
        'Path_B',
        getNamedRootArg(args, 'root_b') || getRootArg(args)
      )

      let contentA: string
      let contentB: string
      try {
        contentA = await fs.readFile(pathA.realPath, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to read file A: ${(err as Error).message}`)
      }
      try {
        contentB = await fs.readFile(pathB.realPath, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to read file B: ${(err as Error).message}`)
      }

      const linesA = contentA.split(/\r?\n/)
      const linesB = contentB.split(/\r?\n/)

      const diffResult = generateUnifiedDiff(linesA, linesB)

      return {
        resultForModel: `File A (${pathA.rootKind}): ${pathA.relPath}\nFile B (${pathB.rootKind}): ${pathB.relPath}\n\nDiff:\n${diffResult}`,
        resultForUi: {
          title: `Compare Files: ${pathA.relPath} vs ${pathB.relPath}`,
          summary:
            diffResult === 'Files are identical.'
              ? 'Files are identical'
              : 'Generated file differences diff'
        }
      }
    }
  }
}

interface DiffChange {
  type: 'added' | 'removed' | 'unchanged'
  value: string
  lineA?: number
  lineB?: number
}

function generateUnifiedDiff(a: string[], b: string[], contextSize = 3): string {
  const maxLines = 2000
  const linesA = a.slice(0, maxLines)
  const linesB = b.slice(0, maxLines)

  const m = linesA.length
  const n = linesB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const changes: DiffChange[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      changes.unshift({ type: 'unchanged', value: linesA[i - 1], lineA: i, lineB: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'added', value: linesB[j - 1], lineB: j })
      j--
    } else {
      changes.unshift({ type: 'removed', value: linesA[i - 1], lineA: i })
      i--
    }
  }

  const outputLines: string[] = []
  let hunk: DiffChange[] = []
  let contextBefore: DiffChange[] = []
  let contextAfterCount = 0
  let inHunk = false

  const flushHunk = (): void => {
    if (hunk.length === 0) return
    const firstChange = hunk.find((c) => c.type !== 'unchanged') || hunk[0]
    const startA = firstChange.lineA ?? hunk[0].lineA ?? 1
    const startB = firstChange.lineB ?? hunk[0].lineB ?? 1
    const countA = hunk.filter((c) => c.type !== 'added').length
    const countB = hunk.filter((c) => c.type !== 'removed').length

    outputLines.push(`@@ -${startA},${countA} +${startB},${countB} @@`)
    for (const c of hunk) {
      if (c.type === 'added') outputLines.push(`+ ${c.value}`)
      else if (c.type === 'removed') outputLines.push(`- ${c.value}`)
      else outputLines.push(`  ${c.value}`)
    }
    hunk = []
  }

  for (const c of changes) {
    if (c.type === 'unchanged') {
      if (inHunk) {
        hunk.push(c)
        contextAfterCount++
        if (contextAfterCount >= contextSize) {
          flushHunk()
          inHunk = false
        }
      } else {
        contextBefore.push(c)
        if (contextBefore.length > contextSize) {
          contextBefore.shift()
        }
      }
    } else {
      if (!inHunk) {
        hunk.push(...contextBefore)
        contextBefore = []
        inHunk = true
      }
      hunk.push(c)
      contextAfterCount = 0
    }
  }

  if (inHunk) {
    flushHunk()
  }

  if (a.length > maxLines || b.length > maxLines) {
    outputLines.push(`\n[Warning: Files were truncated to ${maxLines} lines for diff comparison]`)
  }

  return outputLines.length > 0 ? outputLines.join('\n') : 'Files are identical.'
}
