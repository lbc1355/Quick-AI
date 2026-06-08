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
  | {
      type: 'agent_progress'
      step: number
      maxSteps: number
      activeTools?: string[]
      message?: string
    }
  | {
      type: 'agent_end'
      status: 'completed' | 'cancelled' | 'failed' | 'max_steps'
      error?: string
    }
  | {
      type: 'resource_update'
      resource: SessionResource
    }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  files?: Array<{ name: string; content: string; type: string }>
  agentRunId?: string
  agentEvents?: AgentEvent[]
  /** UI-visible runtime/API failure. Kept in history but omitted from future model context. */
  isRuntimeError?: boolean
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

export type ResourceKind = 'web' | 'paper' | 'github_file' | 'local_file' | 'terminal' | 'doc'

export interface SessionResourceChunk {
  id: string
  offset?: number
  endOffset?: number
  page?: number
  section?: string
  text?: string
  summary?: string
  createdAt: number
}

export interface SessionResource {
  id: string
  kind: ResourceKind
  source: string
  title?: string
  fingerprint?: string
  totalChars?: number
  fetchedRanges?: Array<{ start: number; end: number }>
  nextOffset?: number
  status: 'partial' | 'complete' | 'stale'
  summary?: string
  /** Run ids (reqId / agentRunId) that fetched or touched this resource. Used to prune the
   * resource when the conversation turns that produced it are removed by an edit/regenerate. */
  runIds?: string[]
  chunks: SessionResourceChunk[]
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  lastActiveTime?: number
  resources?: SessionResource[]
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

/** A persistent user memory. `global` survives across all conversations; `session` is bound to
 * one conversation and is cascade-deleted with it. Stored in the user_memories table. */
export interface UserMemory {
  id: string
  scope: 'global' | 'session'
  sessionId?: string
  category: string
  content: string
  createdAt: number
  updatedAt: number
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
  resources?: SessionResource[]
  /** Conversation id used to persist the agent's action log across runs. */
  sessionId?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
}

export interface ChatChunkData {
  reqId: string
  content?: string
  reasoningContent?: string
  done?: boolean
  cancelled?: boolean
  error?: string
  event?: AgentEvent
}

export interface ClearSessionCachesPayload {
  /** Conversation ids whose action-log files should be deleted (whole file). */
  sessionIds: string[]
  /** Resource ids (md5 of source url) whose cache files should be deleted — caller ensures no
   * surviving session still references them. */
  resourceIds: string[]
  /** Partial action-log cleanup: within a surviving session, delete only the records belonging
   * to the given run ids (used by edit/regenerate, which removes some turns but not the session). */
  partialActions?: Array<{ sessionId: string; runIds: string[] }>
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
  resources?: SessionResource[]
  /** Conversation id used to persist the agent's action log across runs. */
  sessionId?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
}
