import { fetchUrl, webSearch } from './webTools'
import { ToolArgs, ChatToolDeclaration } from '../shared/types'

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
  execute: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<{
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

export function searchToolDefinitions(query: string, scope?: Set<string> | 'all'): ToolSummary[] {
  const cleanQuery = query.toLowerCase().trim()
  const matched: ToolSummary[] = []

  for (const key in ToolRegistry) {
    const tool = ToolRegistry[key]
    if (!tool.discoverable || !tool.implemented) continue
    if (scope && scope !== 'all' && !scope.has(tool.name)) continue

    const matchText = `${tool.name} ${tool.title} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase()
    if (cleanQuery === '' || matchText.includes(cleanQuery)) {
      matched.push({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        permission: 'allow'
      })
    }
  }

  return matched
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    title: 'Fetch URL Content',
    description: 'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
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
    execute: async (args: ToolArgs) => {
      const url = args.url
      if (typeof url !== 'string' || !url) {
        throw new Error('Missing or invalid URL parameter')
      }
      const result = await fetchUrl(url)

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
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path.' }
      },
      required: ['path']
    },
    execute: async (args: ToolArgs) => {
      const path = args.path
      if (typeof path !== 'string' || !path) {
        throw new Error('Missing or invalid path parameter')
      }
      return {
        resultForModel: `Content of file at ${path} (stub)`,
        resultForUi: {
          title: `Read File: ${path}`,
          summary: `Mock content of file at ${path}`
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
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path.' },
        content: { type: 'string', description: 'The file content.' }
      },
      required: ['path', 'content']
    },
    execute: async (args: ToolArgs) => {
      const path = args.path
      const content = args.content
      if (typeof path !== 'string' || !path || typeof content !== 'string') {
        throw new Error('Missing or invalid path/content parameters')
      }
      return {
        resultForModel: `Successfully wrote content to ${path} (stub)`,
        resultForUi: {
          title: `Write File: ${path}`,
          summary: `Mock write to file at ${path}`
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
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' }
      },
      required: ['command']
    },
    execute: async (args: ToolArgs) => {
      const command = args.command
      if (typeof command !== 'string' || !command) {
        throw new Error('Missing or invalid command parameter')
      }
      return {
        resultForModel: `Output of shell command: "${command}" (stub)`,
        resultForUi: {
          title: `Shell Command`,
          summary: `Mock execution of command: "${command}"`
        }
      }
    }
  },
  search_tools: {
    name: 'search_tools',
    title: 'Search Tools',
    description: 'Search the tool registry for available tools that can help with the user request.',
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
    execute: async () => {
      return {
        resultForModel: '[]',
        resultForUi: {
          title: 'Search Tools',
          summary: 'Executing tool search...'
        }
      }
    }
  }
}
