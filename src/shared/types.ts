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

export interface UserChoiceOption {
  id: string
  label: string
  value?: string
  description?: string
}

export interface UserChoiceRequest {
  reqId: string
  requestId: string
  title?: string
  question: string
  options: UserChoiceOption[]
  allowCustom?: boolean
  placeholder?: string
}

export interface UserChoiceResponse {
  selectedOptionId?: string
  selectedLabel?: string
  selectedValue?: string
  customValue?: string
  cancelled?: boolean
}

export interface PromptCacheStats {
  promptTokens?: number
  cacheHitTokens: number
  cacheMissTokens?: number
  hitRate: number
}

export type AgentEvent =
  | { type: 'agent_start'; skillName: string }
  | { type: 'reasoning'; content: string; step?: number; stepId?: string }
  | { type: 'agent_message_delta'; content: string; step: number; stepId: string }
  | {
      type: 'agent_step'
      stepId: string
      step: number
      maxSteps: number
      title: string
      message: string
      status: 'running' | 'completed' | 'failed' | 'cancelled'
    }
  | {
      type: 'agent_step_end'
      stepId: string
      status: 'completed' | 'failed' | 'cancelled'
    }
  | {
      type: 'tool_call'
      callId: string
      toolName: string
      args: unknown
      purpose?: string
      permissionState?: 'pending' | 'approved' | 'denied'
      step?: number
      stepId?: string
    }
  | {
      type: 'tool_result'
      callId: string
      result: ToolResultUi
      step?: number
      stepId?: string
    }
  | { type: 'tool_error'; callId: string; error: string; step?: number; stepId?: string }
  | { type: 'final'; content: string; step?: number; stepId?: string }
  | {
      type: 'agent_progress'
      step: number
      maxSteps: number
      activeTools?: string[]
      message?: string
      stepId?: string
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
  | {
      type: 'task_update'
      tasks: TaskItem[]
    }

export interface TaskItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  files?: Array<{ name: string; content: string; type: string }>
  agentRunId?: string
  agentRunIds?: string[]
  agentEvents?: AgentEvent[]
  /** UI-visible runtime/API failure. Kept in history but omitted from future model context. */
  isRuntimeError?: boolean
  /** True when this visible message belongs to a lightweight fork created from history. */
  isBranchFork?: boolean
  /** Source session/message when a branch-like session was forked from history. */
  forkedFrom?: { sessionId: string; messageId: string; runId?: string }
  tokenSpeed?: number
  cacheStats?: PromptCacheStats
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
  projectId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ApiProvider {
  id: string
  name: string
  type: 'deepseek' | 'kimi' | 'ollama' | 'glm' | 'custom'
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
  webSearch?: WebSearchConfig
}

/** Which web search backend to use. 'auto' picks an API provider when an apiKey is configured,
 *  otherwise falls back to the built-in HTML scraping engines (Bing/Sogou/DuckDuckGo). */
export type WebSearchProviderType = 'auto' | 'html' | 'tavily' | 'brave'

export interface WebSearchConfig {
  provider: WebSearchProviderType
  apiKey?: string
}

export type WindowMode = 'floating' | 'window'

export interface WindowState {
  mode: WindowMode
  isMaximized: boolean
}

export type SkillMode = 'insert' | 'send' | 'run'
export type SkillKind = 'prompt' | 'agent'

export interface SkillPackageFile {
  path: string
  content: string
  size: number
}

export interface SkillInterfaceMetadata {
  displayName?: string
  shortDescription?: string
  iconSmall?: string
  iconLarge?: string
  defaultPrompt?: string
}

export interface Skill {
  id: string
  name: string
  trigger: string
  prompt: string
  description?: string
  interface?: SkillInterfaceMetadata
  triggers?: string[]
  mode?: SkillMode
  kind?: SkillKind
  tools?: string[]
  maxSteps?: number
  rawMarkdown?: string
  source?: 'manual' | 'markdown' | 'folder'
  entryPath?: string
  packageRoot?: string
  packageFiles?: SkillPackageFile[]
  installedAt?: number
  updatedAt?: number
  toolDiscovery?: 'static' | 'dynamic'
  filePath?: string
  dirPath?: string
}

export interface SkillInstallPayload {
  fileName: string
  markdown: string
  source?: Skill['source']
  entryPath?: string
  packageRoot?: string
  packageFiles?: SkillPackageFile[]
}

export interface StorageSchema {
  sessions: Session[]
  settings: AppSettings
  skills: Skill[]
  projects: Project[]
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
  /** Optional real project root attached to this conversation. */
  projectRoot?: string
  projectName?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export interface ChatChunkData {
  reqId: string
  content?: string
  reasoningContent?: string
  done?: boolean
  cancelled?: boolean
  error?: string
  event?: AgentEvent
  tokenSpeed?: number
  cacheStats?: PromptCacheStats
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

export interface ForkSessionCachesPayload {
  sourceSessionId: string
  targetSessionId: string
  runIds: string[]
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
  /** Optional real project root attached to this conversation. */
  projectRoot?: string
  projectName?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export interface McpServerStatus {
  name: string
  status: 'connected' | 'connecting' | 'failed' | 'disabled'
  error?: string
  tools: {
    name: string
    description?: string
  }[]
}
