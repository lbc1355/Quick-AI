import { fetchUrl, webSearch, formatSearchResultsForModel } from './webTools'
import { ToolArgs, ChatToolDeclaration, ToolResultUi } from '../shared/types'
import { getRun } from './agent/AgentRunContext'
import { resolve, normalize, relative, isAbsolute, basename, join } from 'path'
import { promises as fs } from 'fs'

export function getWorkspaceRoot(): string {
  return normalize(resolve(process.cwd()))
}

export function isPathInWorkspace(filePath: string): boolean {
  const root = getWorkspaceRoot()
  const resolved = normalize(resolve(root, filePath))
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
  const matched: ToolSummary[] = []

  for (const key in ToolRegistry) {
    const tool = ToolRegistry[key]
    if (!tool.discoverable || !tool.implemented) continue
    if (scope && scope !== 'all' && !scope.has(tool.name)) continue

    const permission = permissionPolicy?.[tool.name] || 'allow'
    if (permission === 'deny') continue

    const matchText =
      `${tool.name} ${tool.title} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase()
    if (cleanQuery === '' || matchText.includes(cleanQuery)) {
      matched.push({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        permission
      })
    }
  }

  return matched
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    title: 'Fetch URL Content',
    description:
      'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
    tags: ['web', 'scraper', 'fetch', 'parse'],
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
    tags: ['web', 'search', 'query', 'bing', 'sogou', 'duckduckgo'],
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
    tags: ['file', 'read', 'local'],
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
      const resolvedPath = resolve(root, filePath)

      if (!isPathInWorkspace(resolvedPath)) {
        throw new Error(`Security Violation: Path is outside the workspace directory.`)
      }

      if (isSensitiveFile(resolvedPath)) {
        throw new Error(`Security Violation: Reading sensitive file is blocked.`)
      }

      try {
        const stats = await fs.stat(resolvedPath)
        if (stats.isDirectory()) {
          throw new Error('Path is a directory, not a file.')
        }
      } catch (err) {
        const error = err as Error
        throw new Error(`Failed to read file: ${error.message}`)
      }

      let content = ''
      try {
        content = await fs.readFile(resolvedPath, 'utf-8')
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
      const relPath = relative(root, resolvedPath).replace(/\\/g, '/')

      const resultForModel = [
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
          summary: `Read lines ${offset}-${offset - 1 + slicedLines.length} of ${totalLines}`
        }
      }
    }
  },
  workspace_search: {
    name: 'workspace_search',
    title: 'Workspace Search',
    description:
      'Search for text matches within files in the workspace root directory (skipping build/dependency folders).',
    tags: ['file', 'search', 'grep', 'local', 'find'],
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
      const searchRegex = new RegExp(
        query.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
        caseSensitive ? '' : 'i'
      )

      let globRegex: RegExp | undefined = undefined
      if (globPattern) {
        const pattern = globPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*([^*]|$)/g, '[^/]*$1')
          .replace(/\?/g, '[^/]')
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
        if (ctx.signal.aborted) return

        const dirents = await fs.readdir(dir, { withFileTypes: true })
        for (const dirent of dirents) {
          if (matches.length >= limit) break
          const resPath = join(dir, dirent.name)
          const relPath = relative(root, resPath)

          if (dirent.isDirectory()) {
            if (['.git', 'node_modules', 'dist', 'out', 'build'].includes(dirent.name)) {
              continue
            }
            await walk(resPath)
          } else {
            if (globRegex) {
              const normalizedRelPath = relPath.replace(/\\/g, '/')
              if (!globRegex.test(normalizedRelPath)) {
                continue
              }
            }

            if (!isPathInWorkspace(resPath) || isSensitiveFile(resPath)) {
              continue
            }

            try {
              const content = await fs.readFile(resPath, 'utf-8')
              const lines = content.split(/\r?\n/)
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= limit) break
                const line = lines[i]
                if (searchRegex.test(line)) {
                  const lineNumber = i + 1
                  const contextBefore = lines.slice(Math.max(0, i - 1), i)
                  const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 2))
                  matches.push({
                    relativePath: relPath,
                    absolutePath: resPath,
                    lineNumber,
                    lineContent: line,
                    contextBefore,
                    contextAfter
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

      const resultForModel =
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

      return {
        resultForModel,
        resultForUi: {
          title: `Workspace Search: "${query}"`,
          summary: `Found ${matches.length} matches`,
          items
        }
      }
    }
  },
  file_write: {
    name: 'file_write',
    title: 'Write File',
    description: 'Writes content to a local file (stub).',
    tags: ['file', 'write', 'local', 'save'],
    category: 'file',
    risk: 'medium',
    implemented: false,
    discoverable: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path.' },
        content: { type: 'string', description: 'The file content.' }
      },
      required: ['path', 'content']
    },
    execute: async () => {
      // Not yet implemented. Fail loudly instead of reporting a fake success.
      throw new Error('Tool "file_write" is not implemented yet.')
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
