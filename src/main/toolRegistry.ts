import { fetchUrl, webSearch, formatSearchResultsForModel } from './webTools'
import { ToolArgs, ChatToolDeclaration, ToolResultUi } from '../shared/types'
import { getRun } from './agent/AgentRunContext'
import { resolve, normalize, relative, isAbsolute, basename, join, dirname } from 'path'
import { promises as fs, realpathSync } from 'fs'

export function getWorkspaceRoot(): string {
  let root = normalize(resolve(process.cwd()))
  try {
    root = realpathSync(root)
  } catch {
    // Ignore and fallback
  }
  return root
}

export function isPathInWorkspace(filePath: string): boolean {
  const root = getWorkspaceRoot()
  let resolved = normalize(resolve(root, filePath))
  try {
    resolved = realpathSync(resolved)
  } catch {
    // Ignore and fallback
  }
  const relativePath = relative(root, resolved)
  if (resolved === root) return true
  return !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

export function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase()
  if (name === '.env' || name.startsWith('.env.')) {
    return true
  }
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name)) {
    return true
  }
  const sensitiveExtensions = ['.pem', '.key', '.pfx', '.p12', '.cert', '.crt', '.der']
  if (sensitiveExtensions.some((ext) => name.endsWith(ext))) {
    return true
  }
  return false
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SEARCH_IGNORE_EXTENSIONS = [
  // Images & Media
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.mp4', '.mp3', '.wav', '.ogg',
  // Archives & Compressed files
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  // Compiled / Binary formats
  '.exe', '.dll', '.so', '.dylib', '.bin', '.pdf', '.docx', '.xlsx', '.pptx', '.class', '.pyc', '.o', '.a',
  // Heavy Lockfiles
  '-lock.json', '.lock', '-lock.yaml', '.lockb'
]

export interface ToolExecutionContext {
  reqId: string
  signal: AbortSignal
}

export interface ToolDefinition {
  name: string
  title: string
  description: string
  tags: string[]
  dependencies?: string[]
  category: 'web' | 'file' | 'shell' | 'memory' | 'system'
  risk: 'low' | 'medium' | 'high'
  implemented: boolean
  discoverable: boolean
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  execute: (
    args: ToolArgs,
    ctx: ToolExecutionContext
  ) => Promise<{
    resultForModel: string
    resultForUi: ToolResultUi
  }>
}

export interface ToolSummary {
  name: string
  title: string
  description: string
  category: string
  risk: string
  permission: string
}

export function toChatToolDeclaration(tool: ToolDefinition): ChatToolDeclaration {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }
}

export function searchToolDefinitions(
  query: string,
  scope?: Set<string> | 'all',
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): ToolSummary[] {
  const cleanQuery = query.toLowerCase().trim()
  if (cleanQuery === '') {
    const matched: ToolSummary[] = []
    for (const key in ToolRegistry) {
      const tool = ToolRegistry[key]
      if (!tool.discoverable || !tool.implemented) continue
      if (scope && scope !== 'all' && !scope.has(tool.name)) continue
      const permission = permissionPolicy?.[tool.name] || 'allow'
      if (permission === 'deny') continue
      matched.push({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        permission
      })
    }
    return matched
  }

  const queryWords = cleanQuery.split(/\s+/).filter(Boolean)
  const resultsWithScore: Array<{ tool: ToolSummary; score: number }> = []

  for (const key in ToolRegistry) {
    const tool = ToolRegistry[key]
    if (!tool.discoverable || !tool.implemented) continue
    if (scope && scope !== 'all' && !scope.has(tool.name)) continue

    const permission = permissionPolicy?.[tool.name] || 'allow'
    if (permission === 'deny') continue

    const matchText =
      `${tool.name} ${tool.title} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase()

    let score = 0
    for (const word of queryWords) {
      if (matchText.includes(word)) {
        score += 10
      } else {
        if (word.endsWith('s') && matchText.includes(word.slice(0, -1))) {
          score += 8
        } else if (matchText.includes(word + 's')) {
          score += 8
        }

        const isChinese = /[\u4e00-\u9fa5]/.test(word)
        if (isChinese) {
          const chars = [...word]
          let charMatchCount = 0
          for (const char of chars) {
            if (matchText.includes(char)) {
              charMatchCount++
            }
          }
          if (charMatchCount > 0) {
            score += Math.round((charMatchCount / chars.length) * 5)
          }
        }
      }
    }

    if (score > 0) {
      resultsWithScore.push({
        tool: {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          category: tool.category,
          risk: tool.risk,
          permission
        },
        score
      })
    }
  }

  resultsWithScore.sort((a, b) => b.score - a.score)
  return resultsWithScore.map((r) => r.tool)
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    title: 'Fetch URL Content',
    description:
      'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
    tags: ['web', 'scraper', 'fetch', 'parse', '网页', '抓取', '读取', '爬虫', '获取'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute public URL to fetch.'
        }
      },
      required: ['url']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const url = args.url
      if (typeof url !== 'string' || !url) {
        throw new Error('Missing or invalid URL parameter')
      }
      const result = await fetchUrl(url, ctx.signal)

      const formatLinks = (res: typeof result): string => {
        return res.links
          .slice(0, 25)
          .map((link, index) => `${index + 1}. ${link.text} - ${link.href}`)
          .join('\n')
      }

      const links = formatLinks(result)
      const body = [
        `URL: ${result.finalUrl}`,
        result.title ? `Title: ${result.title}` : '',
        result.truncated ? 'Note: page text was truncated.' : '',
        links ? `Links:\n${links}` : '',
        `Text:\n${result.text}`
      ]
        .filter(Boolean)
        .join('\n\n')

      return {
        resultForModel: body.slice(0, 12000),
        resultForUi: {
          title: result.title || undefined,
          url: result.finalUrl || undefined,
          summary: result.text
            ? result.text.slice(0, 200) + (result.text.length > 200 ? '...' : '')
            : undefined
        }
      }
    }
  },
  web_search: {
    name: 'web_search',
    title: 'Web Search',
    description:
      'Search the web using Bing, Sogou, or DuckDuckGo fallback to find web pages matching a query.',
    tags: ['web', 'search', 'query', 'bing', 'sogou', 'duckduckgo', '搜索', '网页', '查找'],
    dependencies: ['fetch_url'],
    category: 'web',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search keywords or query.' }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const query = args.query
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }
      const results = await webSearch(query, ctx.signal)
      const formatted = formatSearchResultsForModel(results)
      const resultForModel = `${formatted}\n\nInstruction: Pick 1 to 3 relevant URLs and call fetch_url before final answer when current page content matters.`
      return {
        resultForModel,
        resultForUi: {
          title: `Search: ${query}`,
          summary: `Found ${results.length} results`,
          items: results
        }
      }
    }
  },
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

      if (!isPathInWorkspace(realPath)) {
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
          throw new Error(`File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max supported size is 2 MB.`)
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
      const SEARCH_TIMEOUT_MS = 10000 // 10 seconds

      let filesScanned = 0
      let dirsScanned = 0
      const startTime = Date.now()
      let scanTruncatedReason: string | undefined = undefined

      const searchRegex = new RegExp(
        escapeRegExp(query),
        caseSensitive ? '' : 'i'
      )

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

            // Skip symbolic links to avoid escaping the workspace via junctions
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

            // Skip binary/media files by extension
            const lowerName = dirent.name.toLowerCase()
            if (SEARCH_IGNORE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
              continue
            }

            // Skip oversized files
            const MAX_SEARCH_FILE_BYTES = 512 * 1024 // 512KB
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

      const summaryText = `Found ${matches.length} matches in ${root}` + (scanTruncatedReason ? ` (Scan truncated: ${scanTruncatedReason})` : '')

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
    description: 'Lists files matching a glob wildcard pattern within the workspace root directory.',
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
      const SEARCH_TIMEOUT_MS = 10000 // 10 seconds

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

            // Skip symbolic links to avoid escaping the workspace
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
              .map((m) => `File: ${m.relativePath}\nSize: ${m.size} bytes\nModified: ${m.modifiedTime}`)
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

      const summaryText = `Found ${matches.length} files in ${root}` + (scanTruncatedReason ? ` (Scan truncated: ${scanTruncatedReason})` : '')

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
    tags: ['file', 'write', 'local', 'save', '文件', '写入', '保存', '修改', '编辑', '创建', '翻译'],
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
          description: 'Whether to fail if file exists ("create") or overwrite ("overwrite"). (default: "create")',
          enum: ['create', 'overwrite']
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to automatically create parent directories if they do not exist. (default: true)'
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

      // Get realPath to check if it's within workspace (resolve symlinks if any exist in path)
      let realPath = resolvedPath
      try {
        realPath = await fs.realpath(resolvedPath)
      } catch {
        // Path might not exist, but let's resolve its parent dir realpath to check
        try {
          const parentDir = await fs.realpath(dirname(resolvedPath))
          realPath = join(parentDir, basename(resolvedPath))
        } catch {
          // Fallback to containment checks on resolvedPath if parent does not exist either
        }
      }

      if (!isPathInWorkspace(realPath)) {
        throw new Error(`Security Violation: Path is outside the workspace directory.`)
      }

      if (isSensitiveFile(realPath)) {
        throw new Error(`Security Violation: Writing to sensitive file is blocked.`)
      }

      const MAX_WRITE_BYTES = 2 * 1024 * 1024 // 2MB
      const contentBuffer = Buffer.from(content, 'utf-8')
      if (contentBuffer.length > MAX_WRITE_BYTES) {
        throw new Error(`File content is too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)} MB). Max supported write size is 2 MB.`)
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
        throw new Error(`File already exists and mode is set to "create". To overwrite, set mode to "overwrite".`)
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
  shell: {
    name: 'shell',
    title: 'Execute Shell Command',
    description: 'Executes a command line instruction (stub).',
    tags: ['shell', 'exec', 'command', 'terminal'],
    category: 'shell',
    risk: 'high',
    implemented: false,
    discoverable: false,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' }
      },
      required: ['command']
    },
    execute: async () => {
      // Not yet implemented. Fail loudly instead of reporting a fake command result.
      throw new Error('Tool "shell" is not implemented yet.')
    }
  },
  search_tools: {
    name: 'search_tools',
    title: 'Search Tools',
    description:
      'Search the tool registry for available tools that can help with the user request.',
    tags: ['meta', 'utility', 'find', 'discovery'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: false,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query to search for tools (e.g., "web search" or "file read").'
        }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const query = (args.query as string) || ''
      const runCtx = getRun(ctx.reqId)
      const scope = runCtx ? runCtx.toolScope : 'all'
      const permissionPolicy = runCtx?.permissionPolicy
      const matchedSummaries = searchToolDefinitions(query, scope, permissionPolicy)

      if (runCtx) {
        matchedSummaries.forEach((t) => {
          runCtx.activateTool(t.name)
          const fullToolDef = ToolRegistry[t.name]
          if (fullToolDef && fullToolDef.dependencies) {
            fullToolDef.dependencies.forEach((dep) => {
              const depDef = ToolRegistry[dep]
              if (!depDef || !depDef.implemented) return
              if (scope !== 'all' && !scope.has(dep)) return
              const permission = permissionPolicy?.[dep] || 'allow'
              if (permission === 'deny') return

              runCtx.activateTool(dep)
            })
          }
        })
      }

      const observation =
        matchedSummaries.length > 0
          ? JSON.stringify(matchedSummaries, null, 2)
          : `No discoverable tools matched query: "${query}"`

      return {
        resultForModel: observation,
        resultForUi: {
          title: `Search Tools: "${query}"`,
          summary: `Discovered ${matchedSummaries.length} tools: ${matchedSummaries.map((m) => m.name).join(', ')}`
        }
      }
    }
  }
}
