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
  /** Prevents automatic prompt-derived titles from overwriting an explicit user rename. */
  titleManuallyEdited?: boolean
  messages: Message[]
  /** Monotonic boundary used to reject results produced from an obsolete context snapshot. */
  contextEpoch?: number
  lastActiveTime?: number
  resources?: SessionResource[]
  projectId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  /** Staged session rollback. Messages remain recoverable until a new prompt commits it. */
  revert?: SessionRevertState
  /** Per-session thinking intensity override. Absent means resolve from model defaults / auto. */
  reasoningPreference?: ReasoningPreference
}

export type ProjectKind = 'filesystem' | 'folder'

export interface Project {
  id: string
  name: string
  /** Defaults to filesystem for older records that omit the field. */
  kind?: ProjectKind
  /** Required for filesystem projects; omitted for conversation folders. */
  path?: string
  createdAt: number
  updatedAt: number
}

export interface DeleteProjectResult {
  /** Persisted sessions removed together with a conversation folder. */
  deletedSessionIds: string[]
}

export type ProviderEndpointType = 'openai-compatible' | 'ollama-openai' | 'custom'

export type ProviderApiFormat = 'chat-completions' | 'responses'

export type ProviderType =
  | 'opencode'
  | 'deepseek'
  | 'kimi'
  | 'ollama'
  | 'glm'
  | 'mimo'
  | 'step'
  | 'custom'

export type ProviderAuthType = 'bearer' | 'header' | 'none'

export interface ProviderModelDiscoveryPolicy {
  endpointPath: string
  collectionPaths: readonly string[]
  idPaths: readonly string[]
  displayNamePaths: readonly string[]
  contextWindowPaths: readonly string[]
  capabilityPaths: readonly string[]
}

/** Last-known model catalog for one provider account. Discovery is account scoped because
 * endpoints and credentials may expose different model sets for the same provider type. */
export interface ProviderModelDiscoveryCache {
  sourceUrl: string
  models: FetchedModelInfo[]
  checkedAt?: number
  refreshedAt?: number
  error?: string
}

/**
 * Canonical protocol driver used at runtime. `ProviderApiFormat` is kept as the persisted/UI
 * compatibility field; transports are the extensible execution boundary.
 */
export type ModelTransportId = 'openai-chat-completions' | 'openai-responses'

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

/**
 * Small, typed request compatibility switches. They may be configured at provider or model
 * level and are resolved before a request reaches a transport driver.
 */
export interface ModelCompatibilityProfile {
  stripReasoningContent?: boolean
  /** Keep reasoning on assistant tool-call turns when an upstream thinking model requires replay. */
  preserveToolCallReasoningContent?: boolean
  stripToolMessageName?: boolean
  normalizeToolCallContent?: boolean
  stripEmptyToolCalls?: boolean
  omitToolChoice?: boolean
  reasoningFormat?: 'deepseek-style'
}

export interface ResolvedModelCompatibilityProfile {
  stripReasoningContent: boolean
  preserveToolCallReasoningContent: boolean
  stripToolMessageName: boolean
  normalizeToolCallContent: boolean
  stripEmptyToolCalls: boolean
  omitToolChoice: boolean
  reasoningFormat?: 'deepseek-style'
}

/** Adjustable reasoning intensity levels. Not every model exposes every level. */
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * User-facing thinking preference.
 * - `auto`: send no control fields (provider default)
 * - `off`: explicitly disable reasoning when the model supports it
 * - `on`: explicitly enable reasoning on toggle-style models
 * - levels: effort/budget intensity
 */
export type ReasoningPreference = 'auto' | 'off' | 'on' | ReasoningLevel

/** Wire encoding used when a non-auto preference is applied to a request body. */
export type ReasoningRequestEncoding =
  | 'openai-effort'
  | 'openrouter-reasoning'
  | 'openrouter-budget'
  | 'qwen-enable-thinking'
  | 'deepseek-thinking-toggle'

/**
 * Declares how a model exposes reasoning control. Discovery and provider rules resolve into
 * this shape; request encoding never invents levels that are absent here.
 */
export type ModelReasoningControl =
  | {
      mode: 'fixed'
    }
  | {
      mode: 'toggle'
      encoding: Extract<
        ReasoningRequestEncoding,
        'qwen-enable-thinking' | 'deepseek-thinking-toggle'
      >
      supportsOff: boolean
    }
  | {
      mode: 'effort'
      encoding: Extract<ReasoningRequestEncoding, 'openai-effort' | 'openrouter-reasoning'>
      levels: ReasoningLevel[]
      levelMap?: Partial<Record<ReasoningLevel, string>>
      offValue?: string
    }
  | {
      mode: 'budget'
      encoding: 'openrouter-budget'
      levels: ReasoningLevel[]
      budgets: Partial<Record<ReasoningLevel, number>>
      minBudget?: number
      maxBudget?: number
      supportsOff?: boolean
    }

export interface ModelInfo {
  id: string
  apiId: string
  providerId: string
  displayName?: string
  endpointType: ProviderEndpointType
  capabilities?: ModelCapability[]
  features?: ModelFeatureSupport
  compatibility?: ModelCompatibilityProfile
  promptProfile?: ModelPromptProfile
  /**
   * Legacy/combined control field. Prefer discoveredReasoningControl +
   * reasoningControlOverride; kept for older persisted catalogs.
   */
  reasoningControl?: ModelReasoningControl
  /** Control parsed from provider `/models` metadata (may be overridden). */
  discoveredReasoningControl?: ModelReasoningControl
  /** Explicit per-model override; wins over discovery and provider defaults. */
  reasoningControlOverride?: ModelReasoningControl
  limit: {
    context: number
    output?: number
  }
  enabled: boolean
  transportId?: ModelTransportId
  apiFormat?: ProviderApiFormat
}

export interface ApiKeyItem {
  id: string
  name: string
  value: string
}

/** Static provider/model metadata, independent from credentials and endpoint account details. */
export interface ProviderDefinition {
  id: string
  name: string
  type: ProviderType
  endpointType: ProviderEndpointType
  defaultModelId?: string
  models: Record<string, ModelInfo>
  modelContextWindows?: Record<string, number>
  transportId?: ModelTransportId
  apiFormat?: ProviderApiFormat
  features?: ModelFeatureSupport
  compatibility?: ModelCompatibilityProfile
  promptProfile?: ModelPromptProfile
  /** Custom/provider-level fallback when models omit reasoningControl. */
  defaultReasoningControl?: ModelReasoningControl
}

/** Mutable connection/account data for one provider definition. */
export interface ProviderAccount {
  id: string
  providerId: string
  name: string
  apiUrl: string
  apiKeys: ApiKeyItem[]
  activeApiKeyId?: string
  authType: ProviderAuthType
  authHeader?: string
  headers?: Record<string, string>
  modelDiscovery?: ProviderModelDiscoveryCache
}

export type ProviderConnectionAuth =
  | { type: 'bearer'; token: string }
  | { type: 'header'; name: string; value: string }
  | { type: 'none' }

/** Fully selected account connection consumed by model transports. */
export interface ResolvedProviderConnection {
  accountId: string
  providerId: string
  baseUrl: string
  auth: ProviderConnectionAuth
  headers: Record<string, string>
}

export interface ApiProvider {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  apiKeys?: ApiKeyItem[]
  activeApiKeyId?: string
  apiUrl: string
  model: string
  modelsList: string[]
  modelContextWindows?: Record<string, number>
  endpointType?: ProviderEndpointType
  models?: Record<string, ModelInfo>
  transportId?: ModelTransportId
  apiFormat?: ProviderApiFormat
  features?: ModelFeatureSupport
  compatibility?: ModelCompatibilityProfile
  promptProfile?: ModelPromptProfile
  /** Custom provider advanced setting: how reasoning is encoded when models omit metadata. */
  defaultReasoningControl?: ModelReasoningControl
  authType?: ProviderAuthType
  authHeader?: string
  headers?: Record<string, string>
  modelDiscovery?: ProviderModelDiscoveryCache
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
  compatibility?: ResolvedModelCompatibilityProfile
  promptProfile?: ModelPromptProfile
  reasoningControl?: ModelReasoningControl
  contextWindowTokens?: number
  outputTokenLimit?: number
  transportId?: ModelTransportId
  apiFormat?: ProviderApiFormat
}

export interface FetchedModelInfo {
  id: string
  displayName?: string
  contextWindowTokens?: number
  capabilities?: ModelCapability[]
  /** Parsed from reasoning_options / reasoning metadata during discovery. */
  discoveredReasoningControl?: ModelReasoningControl
  /** @deprecated Prefer discoveredReasoningControl. */
  reasoningControl?: ModelReasoningControl
}

export interface ProviderModelDiscoveryRequest {
  fetchUrl: string
  providerType: ProviderType
  providerConnection: ResolvedProviderConnection
  /** Optional manual protocol hint used to pick discovery encodings (esp. custom providers). */
  defaultReasoningControl?: ModelReasoningControl
}

export type ProviderConnectionDiagnosticCode =
  | 'ok'
  | 'authentication'
  | 'permission'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | 'timeout'
  | 'invalid_response'
  | 'empty_catalog'
  | 'network_error'

export interface ProviderConnectionTestResult {
  ok: boolean
  code: ProviderConnectionDiagnosticCode
  message: string
  endpoint: string
  checkedAt: number
  latencyMs: number
  status?: number
  modelCount?: number
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
  /** Per provider+model default thinking intensity. Keys from getReasoningPreferenceKey(). */
  reasoningDefaults?: Record<string, ReasoningPreference>
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
  providerConnection?: ResolvedProviderConnection
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
  /** Snapshotted thinking preference for this run (must not change mid-flight). */
  reasoningPreference?: ReasoningPreference
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
  /** Thinking preference captured when the prompt was admitted. */
  requestedReasoningPreference?: ReasoningPreference
  effectiveReasoningPreference?: ReasoningPreference
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
  requestedReasoningPreference?: ReasoningPreference
  effectiveReasoningPreference?: ReasoningPreference
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
  providerConnection?: ResolvedProviderConnection
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
  /** Snapshotted thinking preference for this run (must not change mid-flight). */
  reasoningPreference?: ReasoningPreference
}

export interface ContextCompactionRequest {
  apiUrl: string
  apiKey: string
  providerConnection?: ResolvedProviderConnection
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

/**
 * The shape of the `window.api` bridge exposed by `src/preload/index.ts` via contextBridge. Single
 * source of truth for the preload API: the implementation (`satisfies PreloadApi`) and the
 * renderer-facing global (`src/preload/index.d.ts`'s `Window.api`) both reference this interface,
 * so the two declarations can never drift apart.
 */
export interface PreloadApi {
  storeGet: <K extends StoreKey>(key: K) => Promise<StoreValue<K>>
  storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>) => Promise<boolean>
  getAppInfo: () => Promise<{ storePath: string; version: string }>
  listAgentTools: () => Promise<AgentToolInfo[]>
  selectProjectDirectory: () => Promise<{ name: string; path: string } | null>
  deleteProject: (
    projectId: string,
    options?: { deleteSessions?: boolean }
  ) => Promise<DeleteProjectResult>
  hideWindow: () => void
  getWindowState: () => Promise<WindowState>
  setWindowMode: (mode: WindowMode) => Promise<WindowState>
  minimizeWindow: () => void
  toggleWindowMaximized: () => void
  toggleDevTools: () => void
  setFilePickerActive: (active: boolean) => void
  setWindowPinned: (pinned: boolean) => void
  reSummonWindow: () => void
  startChatCompletion: (reqId: string, options: ChatRunOptions) => void
  startAgentSkill: (reqId: string, options: AgentSkillRunOptions) => void
  respondToolPermission: (
    reqId: string,
    callId: string,
    approved:
      | boolean
      | {
          approved: boolean
          scope?: 'prefix' | 'tool'
          prefix?: string
          prefixes?: string[]
          tool?: string
        }
  ) => void
  respondUserChoice: (reqId: string, requestId: string, response: UserChoiceResponse) => void
  abortGeneration: (reqId: string) => void
  advanceSessionContext: (sessionId: string, contextEpoch: number) => void
  admitSessionPrompt: (input: AdmitSessionPromptInput) => Promise<AdmitSessionPromptResult>
  listSessionPrompts: (sessionId: string) => Promise<SessionPromptAdmission[]>
  claimNextSessionPrompt: (
    sessionId: string,
    contextEpoch?: number
  ) => Promise<SessionPromptAdmission | undefined>
  completeSessionPrompt: (admissionId: string) => Promise<boolean>
  cancelSessionPrompt: (admissionId: string) => Promise<boolean>
  requeueSessionPrompt: (admissionId: string) => Promise<boolean>
  compactContext: (payload: ContextCompactionRequest) => Promise<ContextCompactionResult>
  previewAgentFileRevert: (sessionId: string, runId: string) => Promise<AgentFileRevertPreview>
  revertAgentFileChanges: (
    input: RevertAgentFileChangesInput
  ) => Promise<RevertAgentFileChangesResult>
  previewSessionFileTransition: (
    input: SessionFileTransitionInput
  ) => Promise<SessionFileTransitionPreview>
  applySessionFileTransition: (
    input: SessionFileTransitionInput
  ) => Promise<SessionFileTransitionResult>
  clearSessionCaches: (payload: ClearSessionCachesPayload) => Promise<{ ok: boolean }>
  forkSessionCaches: (payload: ForkSessionCachesPayload) => Promise<{
    ok: boolean
    actions: number
    checkpoints: number
    manifests: number
    events: number
  }>
  showNotification: (title: string, body: string) => void
  onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
  onBackgroundSubagentResult: (
    callback: (notification: BackgroundSubagentResultNotification) => void
  ) => () => void
  onBackgroundShellResult: (
    callback: (notification: BackgroundShellResultNotification) => void
  ) => () => void
  onBackgroundSubagentEvent: (
    callback: (notification: BackgroundSubagentEventNotification) => void
  ) => () => void
  onSkillsUpdated: (callback: (skills: Skill[]) => void) => () => void
  onWindowStateChanged: (callback: (state: WindowState) => void) => () => void
  onUserChoiceRequest: (callback: (request: UserChoiceRequest) => void) => () => void
  fetchModels: (request: ProviderModelDiscoveryRequest) => Promise<FetchedModelInfo[]>
  testProviderConnection: (
    request: ProviderModelDiscoveryRequest
  ) => Promise<ProviderConnectionTestResult>
  setProviderModelDiscoveryCache: (
    accountId: string,
    cache: ProviderModelDiscoveryCache
  ) => Promise<boolean>
  listMemoryEntries: () => Promise<Array<{ id: string; label: string; kind: string }>>
  readMemoryEntry: (id: string) => Promise<string>
  writeMemoryEntry: (id: string, content: string) => Promise<{ ok: boolean }>
  mcpGetConfig: () => Promise<string>
  mcpSetConfig: (content: string) => Promise<string>
  mcpDeleteServer: (name: string) => Promise<{ deleted: boolean; config: string }>
  mcpGetStatus: () => Promise<McpServerStatus[]>
  mcpReloadServer: (name: string) => Promise<McpServerStatus>
  mcpOpenConfig: () => Promise<void>
  backgroundJobList: (sessionId?: string) => Promise<BackgroundJobInfo[]>
  backgroundJobCancel: (id: string) => Promise<BackgroundJobInfo>
}
