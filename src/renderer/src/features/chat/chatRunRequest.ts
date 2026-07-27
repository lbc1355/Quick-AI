import type {
  AgentSkillRunOptions,
  ChatRunOptions,
  ContextRetentionMode,
  Message,
  ModelRuntimeConfig,
  Project,
  ResolvedProviderConnection,
  RunMode,
  Session,
  Skill
} from '../../../../shared/types'
import { getCachePriorityRetainedRuns } from './resourceCacheCoordinator'
import { getProjectRunContext } from './sessionMutationService'

/**
 * The provider/model configuration a run is dispatched with.
 *
 * The hook mirrors this in a ref so a dispatch triggered from a stale closure still reads the
 * settings the user currently has selected, rather than the ones present when the callback was
 * created. Keeping the shape here lets the payload builders stay pure.
 */
export interface ChatRequestConfig {
  apiKey: string
  apiUrl: string
  providerConnection?: ResolvedProviderConnection
  selectedModel: string
  modelRuntimeConfig?: ModelRuntimeConfig
  contextWindowTokens?: number
  contextRetentionMode: ContextRetentionMode
  systemPrompt: string
  projects: Project[]
}

/**
 * DeepSeek is the only built-in provider whose default endpoint is useless without a key, so an
 * empty key there is a misconfiguration worth interrupting the user for. Every other provider
 * either needs no key (Ollama) or fails with a normal runtime error the error layer can present.
 */
export const needsApiKeyBeforeRun = (
  config: Pick<ChatRequestConfig, 'apiKey' | 'apiUrl'>
): boolean => !config.apiKey && config.apiUrl.includes('deepseek.com')

/** A leading `@skill` mention forces agent mode regardless of the current toggle. */
export const hasAgentMention = (prompt: string): boolean => /^\s*@\S+/.test(prompt)

export const resolveEffectiveRunMode = (prompt: string, fallback: RunMode): RunMode =>
  hasAgentMention(prompt) ? 'agent' : fallback

const buildSharedRunFields = (input: {
  config: ChatRequestConfig
  session: Session
  historyForCachePriority: Message[]
}): Pick<
  ChatRunOptions,
  | 'apiUrl'
  | 'apiKey'
  | 'providerConnection'
  | 'model'
  | 'modelRuntime'
  | 'contextWindowTokens'
  | 'contextRetentionMode'
  | 'cachePriorityRetainedRuns'
  | 'resources'
  | 'projectRoot'
  | 'projectName'
> => {
  const { config, session, historyForCachePriority } = input
  return {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    providerConnection: config.providerConnection,
    model: config.selectedModel,
    modelRuntime: config.modelRuntimeConfig,
    contextWindowTokens: config.contextWindowTokens,
    contextRetentionMode: config.contextRetentionMode,
    cachePriorityRetainedRuns: getCachePriorityRetainedRuns(
      historyForCachePriority,
      config.contextRetentionMode,
      config.systemPrompt
    ),
    resources: session.resources,
    ...getProjectRunContext(session, config.projects)
  }
}

export interface ChatRunRequestInput {
  config: ChatRequestConfig
  session: Session
  /** Messages already converted for the API by `buildApiMessages`. */
  messages: ChatRunOptions['messages']
  /** Session messages the cache-priority retained runs are derived from. */
  historyForCachePriority: Message[]
  runMode: RunMode
  contextEpoch: number
  sourceMessageId?: string
  assistantMessageId: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  /** Set when the run was started by draining the durable prompt inbox. */
  promptAdmissionId?: string
  /** Set when continuing a persisted checkpoint instead of sending a new user turn. */
  resume?: { fromRunId: string; sourceSessionId: string }
}

export const buildChatRunOptions = (input: ChatRunRequestInput): ChatRunOptions => ({
  ...buildSharedRunFields(input),
  messages: input.messages,
  runMode: input.runMode,
  sessionId: input.session.id,
  contextEpoch: input.contextEpoch,
  sourceMessageId: input.sourceMessageId,
  assistantMessageId: input.assistantMessageId,
  ...(input.branchOf ? { branchOf: input.branchOf } : {}),
  ...(input.promptAdmissionId ? { promptAdmissionId: input.promptAdmissionId } : {}),
  ...(input.resume
    ? {
        resumeFromRunId: input.resume.fromRunId,
        resumeSourceSessionId: input.resume.sourceSessionId
      }
    : {})
})

export interface AgentSkillRunRequestInput {
  config: ChatRequestConfig
  session: Session
  historyForCachePriority: Message[]
  skill: Skill
  userInput: string
  contextEpoch: number
  sourceMessageId: string
  assistantMessageId: string
}

export const buildAgentSkillRunOptions = (
  input: AgentSkillRunRequestInput
): AgentSkillRunOptions => ({
  ...buildSharedRunFields(input),
  systemPrompt: input.config.systemPrompt,
  skill: input.skill,
  userInput: input.userInput,
  sessionId: input.session.id,
  contextEpoch: input.contextEpoch,
  sourceMessageId: input.sourceMessageId,
  assistantMessageId: input.assistantMessageId
})
