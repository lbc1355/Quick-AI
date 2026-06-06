import { fetchUrl } from './webTools'

export interface ToolDefinition {
  name: string
  description: string
  implemented: boolean
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  execute: (args: any) => Promise<{
    resultForModel: string
    resultForUi: { title?: string; url?: string; summary?: string }
  }>
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    description: 'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
    implemented: true,
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
    execute: async (args: { url: string }) => {
      const result = await fetchUrl(args.url)
      
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
      ].filter(Boolean).join('\n\n')

      return {
        resultForModel: body.slice(0, 12000),
        resultForUi: {
          title: result.title || undefined,
          url: result.finalUrl || undefined,
          summary: result.text ? (result.text.slice(0, 200) + (result.text.length > 200 ? '...' : '')) : undefined
        }
      }
    }
  },
  web_search: {
    name: 'web_search',
    description: 'Simulates a search engine query (stub).',
    implemented: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' }
      },
      required: ['query']
    },
    execute: async (args: { query: string }) => {
      return {
        resultForModel: `Search results for query: "${args.query}"\n1. Example result - http://example.com`,
        resultForUi: {
          title: `Search: ${args.query}`,
          summary: `Mock search results for "${args.query}"`
        }
      }
    }
  },
  file_read: {
    name: 'file_read',
    description: 'Reads the content of a local file (stub).',
    implemented: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path.' }
      },
      required: ['path']
    },
    execute: async (args: { path: string }) => {
      return {
        resultForModel: `Content of file at ${args.path} (stub)`,
        resultForUi: {
          title: `Read File: ${args.path}`,
          summary: `Mock content of file at ${args.path}`
        }
      }
    }
  },
  file_write: {
    name: 'file_write',
    description: 'Writes content to a local file (stub).',
    implemented: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path.' },
        content: { type: 'string', description: 'The file content.' }
      },
      required: ['path', 'content']
    },
    execute: async (args: { path: string; content: string }) => {
      return {
        resultForModel: `Successfully wrote content to ${args.path} (stub)`,
        resultForUi: {
          title: `Write File: ${args.path}`,
          summary: `Mock write to file at ${args.path}`
        }
      }
    }
  },
  shell: {
    name: 'shell',
    description: 'Executes a command line instruction (stub).',
    implemented: false,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' }
      },
      required: ['command']
    },
    execute: async (args: { command: string }) => {
      return {
        resultForModel: `Output of shell command: "${args.command}" (stub)`,
        resultForUi: {
          title: `Shell Command`,
          summary: `Mock execution of command: "${args.command}"`
        }
      }
    }
  }
}
