import { resolve, relative, join, dirname, basename } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { pathEscapesWorkspace } from '../agent/commandSafety'
import { getRun } from '../agent/AgentRunContext'
import {
  getWorkspaceRoot,
  isPathInWorkspace,
  isSensitiveFile,
  escapeRegExp,
  SEARCH_IGNORE_EXTENSIONS
} from './helpers'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: {
    name: 'file_read',
    title: 'Read File',
    description: 'Reads the content of a local file within the workspace root directory.',
    tags: ['file', 'read', 'local', '文件', '读取', '内容', '读文件'],
    category: 'file',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The relative or absolute path to the file.' },
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
      void ctx
      const filePath = args.path
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('Missing or invalid path parameter')
      }

      const root = getWorkspaceRoot()
      console.log(`[file_read] Workspace root is: ${root}`)
      const resolvedPath = resolve(root, filePath)

      let realPath = resolvedPath
      try {
        realPath = await fs.realpath(resolvedPath)
      } catch {
        // Fallback to resolvedPath to allow containment checks on non-existent paths
      }

      const inputEscapes = pathEscapesWorkspace(filePath)
      const hasRunCtx = !!(ctx.reqId && getRun(ctx.reqId))
      if (!isPathInWorkspace(realPath) && (!inputEscapes || !hasRunCtx)) {
        throw new Error(`Security Violation: Path is outside the workspace directory.`)
      }

      if (isSensitiveFile(realPath)) {
        throw new Error(`Security Violation: Reading sensitive file is blocked.`)
      }

      try {
        const stats = await fs.stat(realPath)
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
        content = await fs.readFile(realPath, 'utf-8')
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
      const relPath = relative(root, realPath).replace(/\\/g, '/')

      const resultForModel = [
        `Workspace Root: ${root}`,
        `File: ${relPath}`,
        `Lines: ${offset} to ${offset - 1 + slicedLines.length} of ${totalLines}`,
        isTruncated ? 'Note: file content was truncated.' : '',
        `Content:\n${resultText}`
      ]
        .filter(Boolean)
        .join('\n\n')

      const fileUrl = `file:///${resolvedPath.replace(/\\/g, '/')}`

      return {
        resultForModel,
        resultForUi: {
          title: `Read File: ${relPath}`,
          url: fileUrl,
          summary: `Read lines ${offset}-${offset - 1 + slicedLines.length} of ${totalLines} in workspace ${root}`
        }
      }
    }
  },
  workspace_search: {
    name: 'workspace_search',
    title: 'Workspace Search',
    description:
      'Search for text matches within files in the workspace root directory (skipping build/dependency folders).',
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

      const root = getWorkspaceRoot()
      console.log(`[workspace_search] Workspace root is: ${root}`)

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

            if (!isPathInWorkspace(resPath) || isSensitiveFile(resPath)) {
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
        `Workspace Root: ${root}`,
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
      'Lists files matching a glob wildcard pattern within the workspace root directory.',
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

      const root = getWorkspaceRoot()
      console.log(`[workspace_list_files] Workspace root is: ${root}`)

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

            if (!isPathInWorkspace(resPath) || isSensitiveFile(resPath)) {
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
        `Workspace Root: ${root}`,
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
    description: 'Writes content to a local file within the workspace root directory.',
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
      void ctx
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

      const root = getWorkspaceRoot()
      console.log(`[file_write] Workspace root is: ${root}`)
      const resolvedPath = resolve(root, filePath)

      let realPath = resolvedPath
      try {
        realPath = await fs.realpath(resolvedPath)
      } catch {
        try {
          const parentDir = await fs.realpath(dirname(resolvedPath))
          realPath = join(parentDir, basename(resolvedPath))
        } catch {
          // Fallback to containment checks on resolvedPath if parent does not exist either
        }
      }

      const inputEscapes = pathEscapesWorkspace(filePath)
      const hasRunCtx = !!(ctx.reqId && getRun(ctx.reqId))
      if (!isPathInWorkspace(realPath) && (!inputEscapes || !hasRunCtx)) {
        throw new Error(`Security Violation: Path is outside the workspace directory.`)
      }

      if (isSensitiveFile(realPath)) {
        throw new Error(`Security Violation: Writing to sensitive file is blocked.`)
      }

      const MAX_WRITE_BYTES = 2 * 1024 * 1024
      const contentBuffer = Buffer.from(content, 'utf-8')
      if (contentBuffer.length > MAX_WRITE_BYTES) {
        throw new Error(
          `File content is too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported write size is 2 MB.`
        )
      }

      let exists = false
      try {
        const stats = await fs.stat(realPath)
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
          const parent = dirname(realPath)
          await fs.mkdir(parent, { recursive: true })
        }
        await fs.writeFile(realPath, content, 'utf-8')
      } catch (err) {
        const error = err as Error
        throw new Error(`Failed to write file: ${error.message}`)
      }

      const relPath = relative(root, realPath).replace(/\\/g, '/')
      const fileUrl = `file:///${resolvedPath.replace(/\\/g, '/')}`

      const resultForModel = `Successfully wrote file: ${relPath}\nSize: ${contentBuffer.length} bytes\nPath: ${realPath}`

      return {
        resultForModel,
        resultForUi: {
          title: `Write File: ${relPath}`,
          url: fileUrl,
          summary: `Wrote ${contentBuffer.length} bytes to ${relPath} (${exists ? 'overwrote' : 'created'}) in workspace ${root}`
        }
      }
    }
  },
  file_edit: {
    name: 'file_edit',
    title: 'Edit File',
    description:
      'Performs exact string replacement in a file within the workspace. Provide the exact text to replace (old_string) and the new text (new_string). By default, old_string must match exactly one location — if it matches multiple locations the edit is rejected with a list of matching lines so you can add more surrounding context to make it unique. Use replace_all=true to replace every occurrence.',
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
      void ctx
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

      const root = getWorkspaceRoot()
      const resolvedPath = resolve(root, filePath)

      let realPath = resolvedPath
      try {
        realPath = await fs.realpath(resolvedPath)
      } catch {
        throw new Error('File does not exist. Use file_write to create a new file.')
      }

      if (!isPathInWorkspace(realPath)) {
        throw new Error('Security Violation: Path is outside the workspace directory.')
      }
      if (isSensitiveFile(realPath)) {
        throw new Error('Security Violation: Editing sensitive file is blocked.')
      }

      let content: string
      try {
        content = await fs.readFile(realPath, 'utf-8')
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
        await fs.writeFile(realPath, newContent, 'utf-8')
      } catch (err) {
        throw new Error(`Failed to write file: ${(err as Error).message}`)
      }

      const relPath = relative(root, realPath).replace(/\\/g, '/')
      const count = replaceAll ? occurrences.length : 1

      return {
        resultForModel: `Successfully edited ${relPath}: replaced ${count} occurrence(s).`,
        resultForUi: {
          title: `Edit File: ${relPath}`,
          summary: `Replaced ${count} occurrence(s) in ${relPath}`
        }
      }
    }
  }
}
