export interface ToolResultUi {
  title?: string
  url?: string
  summary?: string
  items?: Array<{
    title: string
    url: string
    snippet?: string
    source?: string
  }>
}

export type AgentEvent =
  | { type: 'agent_start'; skillName: string }
  | { type: 'reasoning'; content: string }
  | {
      type: 'tool_call'
      callId: string
      toolName: string
      args: unknown
      permissionState?: 'pending' | 'approved' | 'denied'
    }
  | {
      type: 'tool_result'
      callId: string
      result: ToolResultUi
    }
  | { type: 'tool_error'; callId: string; error: string }
  | { type: 'final'; content: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  files?: Array<{ name: string; content: string; type: string }>
  agentRunId?: string
  agentEvents?: AgentEvent[]
}

export interface ChatCompletionMessage {
  role: string
  content?:
    | string
    | Array<{
        type: string
        text?: string
        image_url?: { url: string }
      }>
    | null
  reasoning_content?: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  lastActiveTime?: number
}

export interface ApiProvider {
  id: string
  name: string
  type: 'deepseek' | 'kimi' | 'ollama' | 'custom'
  apiKey: string
  apiUrl: string
  model: string
  modelsList: string[]
}

export interface AppSettings {
  providers: ApiProvider[]
  activeProviderId: string
  systemPrompt: string
  autoHideOnBlur: boolean
  theme?: 'dark' | 'light'
  permissions?: {
    [toolName: string]: 'allow' | 'ask' | 'deny'
  }
}

export type SkillMode = 'insert' | 'send' | 'run'
export type SkillKind = 'prompt' | 'agent'

export interface Skill {
  id: string
  name: string
  trigger: string
  prompt: string
  description?: string
  triggers?: string[]
  mode?: SkillMode
  kind?: SkillKind
  tools?: string[]
  maxSteps?: number
  rawMarkdown?: string
  source?: 'manual' | 'markdown'
  installedAt?: number
  updatedAt?: number
  toolDiscovery?: 'static' | 'dynamic'
}

export interface Memory {
  id: string
  content: string
  createdAt: number
}

export interface StorageSchema {
  sessions: Session[]
  settings: AppSettings
  skills: Skill[]
  memories: Memory[]
}

export type StoreKey = keyof StorageSchema
export type StoreValue<K extends StoreKey> = StorageSchema[K]

export interface AutocompleteItem {
  id: string
  name: string
  trigger: string
  type: 'command' | 'skill' | 'model' | 'session' | 'delete-session' | 'provider'
  cmd?: string
  prompt?: string
  skillId?: string
  skillMode?: SkillMode
  modelId?: string
  sessionId?: string
  providerId?: string
}

export interface AgentSkillRunOptions {
  apiUrl: string
  apiKey: string
  model: string
  systemPrompt?: string
  skill: Skill
  userInput: string
}

export interface ChatChunkData {
  reqId: string
  content?: string
  reasoningContent?: string
  done?: boolean
  error?: string
  event?: AgentEvent
}

export type ToolArgs = Record<string, unknown>

export interface ChatToolDeclaration {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export type RunMode = 'chat' | 'agent'

export interface ChatRunOptions {
  apiUrl: string
  apiKey: string
  model: string
  messages: ChatCompletionMessage[]
  systemPrompt?: string
  runMode?: RunMode
}
