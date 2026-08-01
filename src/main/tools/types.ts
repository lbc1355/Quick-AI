import {
  ToolArgs,
  ChatToolDeclaration,
  ToolResultUi,
  SessionResource,
  AgentEvent,
  ModelRuntimeConfig,
  ReasoningPreference,
  ResolvedProviderConnection,
  UserChoiceRequest,
  BackgroundShellCompletion,
  BackgroundSubagentCompletion,
  BackgroundSubagentLiveEvent
} from '../../shared/types'

/**
 * Electron-specific host interactions a tool may need, expressed as plain callbacks so the tool
 * layer never depends on BrowserWindow. Injected at the transport boundary (agentLoop) and left
 * undefined in headless/test contexts.
 */
export interface AgentHostActions {
  /** Push a user-choice request to the UI (a channel separate from the agent event stream). */
  requestUserChoice?: (request: UserChoiceRequest) => void
  /** Bring the app window to the foreground, e.g. when a reminder notification is clicked. */
  focusWindow?: () => void
  /** Route a detached subagent result back into its parent conversation. */
  publishBackgroundSubagentCompletion?: (completion: BackgroundSubagentCompletion) => void
  /** Route a detached shell result back into its parent conversation. */
  publishBackgroundShellCompletion?: (completion: BackgroundShellCompletion) => void
  /** Stream detached subagent progress independently of the parent run transport. */
  publishBackgroundSubagentEvent?: (update: BackgroundSubagentLiveEvent) => void
}

export interface ToolExecutionContext {
  reqId: string
  callId?: string
  signal: AbortSignal
  host?: AgentHostActions
  resources?: SessionResource[]
  agentModel?: {
    apiUrl: string
    apiKey: string
    providerConnection?: ResolvedProviderConnection
    model: string
    modelRuntime?: ModelRuntimeConfig
    contextWindowTokens?: number
    reasoningPreference?: ReasoningPreference
  }
  emitOutput?: (chunk: { stream: 'stdout' | 'stderr'; content: string; replace?: boolean }) => void
  emitEvent?: (event: AgentEvent) => void
}

export interface ToolModelAttachment {
  type: 'image_url'
  image_url: { url: string }
}

export interface ToolExecutionResult {
  resultForModel: string
  resultForUi: ToolResultUi
  modelAttachments?: ToolModelAttachment[]
}

export interface ToolDefinition {
  name: string
  title: string
  description: string
  tags: string[]
  dependencies?: string[]
  category: 'web' | 'file' | 'shell' | 'memory' | 'system'
  risk: 'low' | 'medium' | 'high'
  source?: 'builtin' | 'mcp' | 'skill' | 'plugin' | 'external'
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
  /**
   * Executes the tool and returns both model-facing content and UI-facing metadata.
   * Prefer createToolResult() from ./result for new tools so frontend details stay consistent.
   */
  execute: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>
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
