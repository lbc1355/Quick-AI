import { ToolArgs, ChatToolDeclaration, ToolResultUi, SessionResource } from '../../shared/types'
import { BrowserWindow } from 'electron'

export interface ToolExecutionContext {
  reqId: string
  signal: AbortSignal
  mainWindow?: BrowserWindow
  resources?: SessionResource[]
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
    properties: Record<
      string,
      { type: string; description?: string; enum?: string[]; items?: Record<string, unknown> }
    >
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
  const parameters = {
    ...tool.parameters,
    properties: {
      ...tool.parameters.properties,
      purpose: {
        type: 'string',
        description:
          'Optional explanation of why this tool is being called (e.g., "Reading package.json to verify dependencies"). Keep it concise (approx. 80-120 characters).'
      }
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters
    }
  }
}
