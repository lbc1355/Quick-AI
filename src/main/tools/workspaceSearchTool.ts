import { join, relative } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { SEARCH_IGNORE_EXTENSIONS, escapeRegExp, isSensitiveFile } from './helpers'
import { ToolDefinition, ToolExecutionContext } from './types'
import { ROOT_PARAMETER, chooseBaseRoot, getRootArg, isPathInsideRoot } from './filePathSafety'
import { globToRegex } from './workspaceGlob'

export const workspaceSearchTool: ToolDefinition = {
  name: 'workspace_search',
  title: 'Workspace Search',
  description:
    'Search for text matches within files in the global workspace or current project root (skipping build/dependency folders). In project conversations, relative paths default to the project root.',
  tags: ['file', 'search', 'grep', 'local', 'find', 'workspace', 'content'],
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
    const globRegex = globPattern ? globToRegex(globPattern) : undefined

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
            const truncLine = (line: string): string =>
              line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + '...' : line
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
            // Ignore unreadable/binary files.
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
            .map((match) => {
              const contextStr = [
                ...match.contextBefore.map((line) => `  [${match.lineNumber - 1}] ${line}`),
                `* [${match.lineNumber}] ${match.lineContent}`,
                ...match.contextAfter.map((line) => `  [${match.lineNumber + 1}] ${line}`)
              ].join('\n')
              return `File: ${match.relativePath} (Line ${match.lineNumber})\nContext:\n${contextStr}`
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

    const items = matches.map((match) => {
      const fileUrl = `file:///${match.absolutePath.replace(/\\/g, '/')}`
      const contextStr = [
        ...match.contextBefore.map((line) => `[${match.lineNumber - 1}] ${line}`),
        `[${match.lineNumber}] ${match.lineContent}`,
        ...match.contextAfter.map((line) => `[${match.lineNumber + 1}] ${line}`)
      ].join('\n')

      return {
        title: `${match.relativePath} Line ${match.lineNumber}`,
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
}
