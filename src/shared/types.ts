import { RuntimeErrorPayload } from './runtimeErrors'

export interface ToolResultUi {
  title?: string
  url?: string
  summary?: string
  details?: string
  items?: Array<{
    title: string
    url: string
    snippet?: string
    source?: string
  }>
  addedLines?: number
  removedLines?: number
  readStartLine?: number
  readEndLine?: number
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

export interface AgentToolInfo {
  name: string
  title: string
  description: string
  category: string
  risk: 'low' | 'medium' | 'high'
  source?: 'builtin' | 'mcp' | 'skill' | 'plugin' | 'external'
  parameters?: {
    type: string
    properties: Record<
      string,
      { type: string; description?: string; enum?: string[]; items?: Record<string, unknown> }
    >
    required?: string[]
  }
}

export type CacheShapeChangeReason =
  | 'system'
  | 'tools'
  | 'context_retention'
  | 'message_shape'
  | 'message_content'
  | 'tool_call_duplication'

export interface CacheShapeDiagnostics {
  prefixHash: string
  prefixChanged: boolean
  prefixChangeReasons: CacheShapeChangeReason[]
  systemHash: string
  toolsHash: string
  messageShapeHash: string
  messageContentHash?: string
  contextRetentionMode?: ContextRetentionMode
  retainedRunCount?: number
  retainedRunHash?: string
  messageCount: number
  previousMessageCount?: number
  currentMessageCount?: number
  toolSchemaTokens: number
  appendOnlyFromPrevious?: boolean
  contentAppendOnlyFromPrevious?: boolean
  firstDifferentMessageIndex?: number
  addedMessageCount?: number
  addedMessageChars?: number
  addedMessageTokens?: number
  duplicateToolCallIds?: string[]
  cacheHitTokens?: number
  cacheMissTokens?: number
}

export interface PromptCacheStats {
  hasCacheStats?: boolean
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cacheHitTokens: number
  cacheMissTokens?: number
  hitRate: number
  cacheDiagnostics?: CacheShapeDiagnostics
}

export interface AgentEventMetadata {
  /** Stable run id that emitted this event. Added by the agent event stream. */
  runId?: string
  /** Monotonic per-run sequence. Added by the agent event stream. */
  sequence?: number
  /** Wall-clock emit time in ms. Added by the agent event stream. */
  timestamp?: number
}

type WithAgentEventMetadata<T> = T & AgentEventMetadata

export type AgentFileChangeKind = 'added' | 'modified' | 'deleted'

export interface AgentFileChange {
  path: string
  kind: AgentFileChangeKind
}

export type AgentEvent =
  | WithAgentEventMetadata<{ type: 'agent_start'; skillName: string }>
  | WithAgentEventMetadata<{ type: 'reasoning'; content: string; step?: number; stepId?: string }>
  | WithAgentEventMetadata<{
      type: 'agent_message_delta'
      content: string
      step: number
      stepId: string
    }>
  | WithAgentEventMetadata<{
      type: 'agent_step'
      stepId: string
      step: number
      maxSteps: number
      title: string
      message: string
      status: 'running' | 'completed' | 'failed' | 'cancelled'
    }>
  | WithAgentEventMetadata<{
      type: 'agent_step_end'
      stepId: string
      status: 'completed' | 'failed' | 'cancelled'
    }>
  | WithAgentEventMetadata<{
      type: 'tool_call'
      callId: string
      toolName: string
      args: unknown
      purpose?: string
      permissionState?: 'pending' | 'approved' | 'denied'
      step?: number
      stepId?: string
    }>
  | WithAgentEventMetadata<{
      type: 'tool_result'
      callId: string
      result: ToolResultUi
      step?: number
      stepId?: string
    }>
  | WithAgentEventMetadata<{
      type: 'tool_output_delta'
      callId: string
      stream: 'stdout' | 'stderr'
      content: string
      replace?: boolean
      step?: number
      stepId?: string
    }>
  | WithAgentEventMetadata<{
      type: 'tool_error'
      callId: string
      error: string
      step?: number
      stepId?: string
    }>
  | WithAgentEventMetadata<{ type: 'final'; content: string; step?: number; stepId?: string }>
  | WithAgentEventMetadata<{
      type: 'agent_progress'
      step: number
      maxSteps: number
      activeTools?: string[]
      message?: string
      stepId?: string
    }>
  | WithAgentEventMetadata<{
      type: 'agent_end'
      status: 'completed' | 'cancelled' | 'failed' | 'max_steps'
      error?: string
    }>
  | WithAgentEventMetadata<{
      type: 'resource_update'
      resource: SessionResource
    }>
  | WithAgentEventMetadata<{
      type: 'task_update'
      tasks: TaskItem[]
    }>
  | WithAgentEventMetadata<{
      type: 'file_changes'
      files: AgentFileChange[]
      revertedAt?: number
    }>
  | WithAgentEventMetadata<{
      type: 'subagent_start'
      subagentId: string
      parentToolCallId: string
      label: string
      task: string
      tools?: string[]
      maxSteps: number
    }>
  | WithAgentEventMetadata<{
      type: 'subagent_event'
      subagentId: string
      event: SubagentInnerEvent
    }>
  | WithAgentEventMetadata<{
      type: 'subagent_end'
      subagentId: string
      status: 'completed' | 'failed' | 'cancelled' | 'max_steps'
      finalAnswer?: string
      error?: string
      durationMs?: number
    }>

export type SubagentInnerEvent = Exclude<
  AgentEvent,
  { type: 'subagent_start' | 'subagent_event' | 'subagent_end' }
>

export type SubagentLifecycleEvent = Extract<
  AgentEvent,
  { type: 'subagent_start' | 'subagent_event' | 'subagent_end' }
>

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
  errorPayload?: RuntimeErrorPayload
  isCompactionSummary?: boolean
  /** App-generated model input (for example a completed background task), not typed by the user. */
  isSynthetic?: boolean
  /** Model context that is persisted but intentionally omitted from the chat interface. */
  isInternal?: boolean
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

export interface SessionRevertState {
  boundaryMessageId: string
  revertedMessages: Message[]
  runIds: string[]
  originalResources?: SessionResource[]
  fileRestorePoint?: SessionFileRestorePoint
  revertedAt: number
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  /** Monotonic boundary used to reject results produced from an obsolete context snapshot. */
  contextEpoch?: number
  lastActiveTime?: number
  resources?: SessionResource[]
  projectId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  /** Staged session rollback. Messages remain recoverable until a new prompt commits it. */
  revert?: SessionRevertState
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export type ProviderEndpointType = 'openai-compatible' | 'ollama-openai' | 'custom'

export type ProviderApiFormat = 'chat-completions' | 'responses'

export type ModelCapability = 'text' | 'vision' | 'tools' | 'reasoning'

export type ModelPromptProfile = 'default' | 'gpt' | 'claude' | 'gemini' | 'reasoning'

/**
 * Transport and behavior features that are independent from content modalities. Optional values
 * are inherited from the provider profile; model-level values override provider-level values.
 */
export interface ModelFeatureSupport {
  toolCalls?: boolean
  parallelToolCalls?: boolean
  reasoning?: boolean
  vision?: boolean
  promptCaching?: boolean
  streamUsage?: boolean
}

export interface ResolvedModelFeatureSupport {
  toolCalls: boolean
  parallelToolCalls: boolean
  reasoning: boolean
  vision: boolean
  promptCaching: boolean
  streamUsage: boolean
}

export interface ModelInfo {
  id: string
  apiId: string
  providerId: string
  displayName?: string
  endpointType: ProviderEndpointType
  capabilities?: ModelCapability[]
  features?: ModelFeatureSupport
  promptProfile?: ModelPromptProfile
  limit: {
    context: number
    output?: number
  }
  enabled: boolean
  apiFormat?: ProviderApiFormat
}

export interface ApiKeyItem {
  id: string
  name: string
  value: string
}

export interface ApiProvider {
  id: string
  name: string
  type: 'opencode' | 'deepseek' | 'kimi' | 'ollama' | 'glm' | 'mimo' | 'step' | 'custom'
  apiKey: string
  apiKeys?: ApiKeyItem[]
  activeApiKeyId?: string
  apiUrl: string
  model: string
  modelsList: string[]
  modelContextWindows?: Record<string, number>
  endpointType?: ProviderEndpointType
  models?: Record<string, ModelInfo>
  apiFormat?: ProviderApiFormat
  features?: ModelFeatureSupport
  promptProfile?: ModelPromptProfile
}

export interface ModelRuntimeConfig {
  providerId?: string
  providerType?: ApiProvider['type']
  endpointType?: ProviderEndpointType
  modelId: string
  apiModel: string
  displayName?: string
  capabilities?: ModelCapability[]
  features?: ResolvedModelFeatureSupport
  promptProfile?: ModelPromptProfile
  contextWindowTokens?: number
  apiFormat?: ProviderApiFormat
}

export interface FetchedModelInfo {
  id: string
  displayName?: string
  contextWindowTokens?: number
}

export type ContextRetentionMode = 'default' | 'cache-priority'

export interface CachePriorityRetainedRunRef {
  runId: string
  assistantMessageIndex: number
}

export interface AppSettings {
  providers: ApiProvider[]
  activeProviderId: string
  systemPrompt: string
  autoHideOnBlur: boolean
  contextRetentionMode?: ContextRetentionMode
  theme?: 'dark' | 'light'
  permissions?: {
    [toolName: string]: 'allow' | 'ask' | 'deny'
  }
  webSearch?: WebSearchConfig
  providerPresetVersion?: number
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
  modelRuntime?: ModelRuntimeConfig
  contextWindowTokens?: number
  contextRetentionMode?: ContextRetentionMode
  cachePriorityRetainedRuns?: CachePriorityRetainedRunRef[]
  systemPrompt?: string
  skill: Skill
  userInput: string
  resources?: SessionResource[]
  /** Conversation id used to persist the agent's action log across runs. */
  sessionId?: string
  contextEpoch?: number
  /** Optional real project root attached to this conversation. */
  projectRoot?: string
  projectName?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  /** Durable prompt admission that owns this run, when started from the session inbox. */
  promptAdmissionId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export interface ChatChunkData {
  reqId: string
  contextEpoch?: number
  content?: string
  reasoningContent?: string
  done?: boolean
  cancelled?: boolean
  error?: string
  errorPayload?: RuntimeErrorPayload
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

export type SessionPromptAdmissionMode = 'steer' | 'queue'
export type SessionPromptAdmissionStatus = 'pending' | 'running' | 'completed' | 'cancelled'

/** A durable user prompt waiting to steer the active agent or start after it. */
export interface SessionPromptAdmission {
  id: string
  sessionId: string
  contextEpoch: number
  mode: SessionPromptAdmissionMode
  status: SessionPromptAdmissionStatus
  runMode: RunMode
  sourceMessageId: string
  assistantMessageId?: string
  messages: ChatCompletionMessage[]
  createdAt: number
  updatedAt: number
}

export interface AdmitSessionPromptInput {
  id: string
  sessionId: string
  contextEpoch?: number
  mode: SessionPromptAdmissionMode
  runMode: RunMode
  sourceMessageId: string
  assistantMessageId?: string
  messages: ChatCompletionMessage[]
}

export interface AdmitSessionPromptResult {
  disposition: 'steered' | 'queued' | 'duplicate'
  prompt: SessionPromptAdmission
}

export type BackgroundSubagentStatus = 'completed' | 'failed' | 'cancelled' | 'max_steps'

export type BackgroundJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'max_steps'
  | 'interrupted'

/** Persisted lifecycle metadata for a detached background task. */
export interface BackgroundJobInfo {
  id: string
  type: string
  title: string
  description?: string
  sessionId?: string
  status: BackgroundJobStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  error?: string
  /** Task-specific, JSON-serializable details such as a shell PID or output offsets. */
  metadata?: Record<string, unknown>
  /** Bounded task output retained for inspection after the owning process exits. */
  output?: string
}

export interface BackgroundShellJobMetadata extends Record<string, unknown> {
  command: string
  cwd: string
  pid?: number
  exitCode?: number | null
  signal?: string | null
  resourceId?: string
  outputBaseOffset: number
  totalOutputChars: number
  totalOutputLines?: number
}

export type BackgroundShellStatus = 'completed' | 'failed' | 'cancelled'

/** Tool-layer completion payload; the agent host adds parent-session routing data. */
export interface BackgroundShellCompletion {
  jobId: string
  parentToolCallId?: string
  command: string
  status: BackgroundShellStatus
  output?: string
  error?: string
  exitCode?: number | null
  signal?: string | null
  durationMs?: number
  resourceId?: string
  resource?: SessionResource
  totalOutputChars?: number
  totalOutputLines?: number
  outputTruncated?: boolean
}

/** Tool-layer completion payload; the agent host enriches it with parent-session routing data. */
export interface BackgroundSubagentCompletion {
  jobId: string
  subagentId: string
  parentToolCallId: string
  task: string
  label: string
  status: BackgroundSubagentStatus
  result?: string
  error?: string
  durationMs?: number
}

/** Tool-to-host event emitted by a detached subagent independently of its parent run stream. */
export interface BackgroundSubagentLiveEvent {
  jobId: string
  event: SubagentLifecycleEvent
}

/** Main-to-renderer live update that remains active after the parent run has finished. */
export interface BackgroundSubagentEventNotification extends BackgroundSubagentLiveEvent {
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
}

/** Main-to-renderer notification emitted after a background result is routed or rejected as stale. */
export interface BackgroundSubagentResultNotification extends BackgroundSubagentCompletion {
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
  disposition: 'steered' | 'queued' | 'stale'
  prompt?: SessionPromptAdmission
}

/** Main-to-renderer notification emitted after a background shell result is routed. */
export interface BackgroundShellResultNotification extends BackgroundShellCompletion {
  sessionId: string
  contextEpoch: number
  parentRunId: string
  parentAssistantMessageId?: string
  disposition: 'steered' | 'queued' | 'stale'
  prompt?: SessionPromptAdmission
}

export interface ChatRunOptions {
  apiUrl: string
  apiKey: string
  model: string
  modelRuntime?: ModelRuntimeConfig
  contextWindowTokens?: number
  contextRetentionMode?: ContextRetentionMode
  cachePriorityRetainedRuns?: CachePriorityRetainedRunRef[]
  messages: ChatCompletionMessage[]
  systemPrompt?: string
  runMode?: RunMode
  resources?: SessionResource[]
  /** Conversation id used to persist the agent's action log across runs. */
  sessionId?: string
  contextEpoch?: number
  /** Optional real project root attached to this conversation. */
  projectRoot?: string
  projectName?: string
  /** Resume from a persisted run checkpoint without adding a new user message. */
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  /** Durable prompt admission that owns this run, when started from the session inbox. */
  promptAdmissionId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export interface ContextCompactionRequest {
  apiUrl: string
  apiKey: string
  model: string
  modelRuntime?: ModelRuntimeConfig
  messages: Message[]
  keepRecentMessages?: number
  systemPrompt?: string
}

export interface ContextCompactionResult {
  summary: string
  compactedCount: number
  keptCount: number
  tokenSpeed?: number
}

export interface AgentFileRevertPreview {
  available: boolean
  reason?: string
  sessionId: string
  runId: string
  projectRoot?: string
  files: Array<AgentFileChange & { conflict: boolean }>
  conflicts: string[]
  diff: string
  alreadyReverted: boolean
  revertedAt?: number
}

export interface RevertAgentFileChangesInput {
  sessionId: string
  runId: string
  force?: boolean
}

export interface RevertAgentFileChangesResult {
  ok: boolean
  restoredFiles: string[]
  conflicts: string[]
  alreadyReverted?: boolean
  error?: string
  revertedAt?: number
}

export type SessionFileTransitionDirection = 'revert' | 'restore'

export interface SessionFileRestorePoint {
  projectRoot: string
  tree: string
  paths: string[]
}

export interface SessionFileTransitionInput {
  sessionId: string
  runIds: string[]
  direction: SessionFileTransitionDirection
  restorePoint?: SessionFileRestorePoint
  force?: boolean
}

export interface SessionFileTransitionPreview {
  available: boolean
  reason?: string
  sessionId: string
  runIds: string[]
  direction: SessionFileTransitionDirection
  projectRoot?: string
  files: Array<AgentFileChange & { conflict: boolean }>
  conflicts: string[]
  diff: string
  alreadyApplied: boolean
}

export interface SessionFileTransitionResult {
  ok: boolean
  changedFiles: string[]
  conflicts: string[]
  alreadyApplied?: boolean
  appliedAt?: number
  restorePoint?: SessionFileRestorePoint
  error?: string
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
