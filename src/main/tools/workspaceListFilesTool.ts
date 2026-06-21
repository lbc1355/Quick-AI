import { join, relative } from 'path'
import { promises as fs } from 'fs'
import { ToolArgs } from '../../shared/types'
import { isSensitiveFile } from './helpers'
import { ToolDefinition, ToolExecutionContext } from './types'
import { ROOT_PARAMETER, chooseBaseRoot, getRootArg, isPathInsideRoot } from './filePathSafety'
import { globToRegex } from './workspaceGlob'

export const workspaceListFilesTool: ToolDefinition = {
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
    'workspace',
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

    const globRegex = globToRegex(globPattern)

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
            // Ignore files we cannot stat.
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
              (match) =>
                `File: ${match.relativePath}\nSize: ${match.size} bytes\nModified: ${match.modifiedTime}`
            )
            .join('\n\n')
        : `No files found matching glob: "${globPattern}"`
    ].join('\n\n')

    if (scanTruncatedReason) {
      resultForModel += `\n\n[Warning: Scan was truncated. Reason: ${scanTruncatedReason}]`
    }

    const items = matches.map((match) => {
      const fileUrl = `file:///${match.absolutePath.replace(/\\/g, '/')}`
      return {
        title: match.relativePath,
        url: fileUrl,
        snippet: `Size: ${match.size} bytes, Modified: ${match.modifiedTime}`,
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
}
