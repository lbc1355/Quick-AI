import { fetchUrl } from './webTools'
import { ToolArgs } from '../shared/types'

export interface ToolDefinition {
  name: string
  description: string
  implemented: boolean
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  execute: (args: ToolArgs) => Promise<{
    resultForModel: string
    resultForUi: { title?: string; url?: string; summary?: string }
  }>
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  fetch_url: {
    name: 'fetch_url',
    description:
      'Fetches the content of a public HTTP or HTTPS web page and returns its title, text content, and extracted links.',
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
    description: 'Simulates a search engine query (stub).',
    implemented: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs) => {
      const query = args.query
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }
      return {
        resultForModel: `Search results for query: "${query}"\n1. Example result - http://example.com`,
        resultForUi: {
          title: `Search: ${query}`,
          summary: `Mock search results for "${query}"`
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
    description: 'Executes a command line instruction (stub).',
    implemented: false,
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
  }
}
