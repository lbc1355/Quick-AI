import { fetchUrl, webSearch } from './webTools'
import { ToolArgs, ChatToolDeclaration } from '../shared/types'
import { getRun } from './agent/AgentRunContext'

export interface ToolExecutionContext {
  reqId: string
  signal: AbortSignal
}

export interface ToolDefinition {
  name: string
  title: string
  description: string
  tags: string[]
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
    resultForUi: { title?: string; url?: string; summary?: string }
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
    description: 'Search the web using DuckDuckGo to find web pages matching a query.',
    tags: ['web', 'search', 'query', 'duckduckgo'],
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
      return {
        resultForModel: results,
        resultForUi: {
          title: `Search: ${query}`,
          summary: results.slice(0, 300) + (results.length > 300 ? '...' : '')
        }
      }
    }
  },
  file_read: {
    name: 'file_read',
    title: 'Read File',
    description: 'Reads the content of a local file (stub).',
    tags: ['file', 'read', 'local'],
    category: 'file',
    risk: 'low',
    implemented: false,
    discoverable: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path.' }
      },
      required: ['path']
    },
    execute: async () => {
      // Not yet implemented. Fail loudly instead of returning fabricated content so a
      // premature `implemented: true` can never feed mock data back to the model.
      throw new Error('Tool "file_read" is not implemented yet.')
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
        matchedSummaries.forEach((t) => runCtx.activateTool(t.name))
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
