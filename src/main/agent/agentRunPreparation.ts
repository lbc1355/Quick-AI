import { AgentSkillRunOptions, ChatCompletionMessage, SessionResource } from '../../shared/types'
import { searchToolDefinitions as defaultSearchToolDefinitions } from '../toolRegistry'
import { ActionLog, getActionLogPath } from './actionLog'
import { insertCachePriorityToolContext } from './cachePriorityContext'
import {
  buildSkillMessages as defaultBuildSkillMessages,
  prepareChatAgentMessages as defaultPrepareChatAgentMessages
} from './messageBuilder'
import {
  buildBranchForkPrompt as defaultBuildBranchForkPrompt,
  cloneMessagesForCheckpoint as defaultCloneMessagesForCheckpoint,
  injectPromptBeforeLatestUser as defaultInjectPromptBeforeLatestUser
} from './resumePrompts'
import {
  AmbiguousAction,
  RunCheckpoint,
  loadRunCheckpoint as defaultLoadRunCheckpoint
} from './runCheckpoint'

export interface AgentSteeringPrompt {
  admissionId: string
  messages: ChatCompletionMessage[]
}

export interface AgentSteeringControls {
  setSteeringAcceptance?: (acceptsSteering: boolean) => void
  drainSteering?: (close: boolean) => AgentSteeringPrompt[]
  onSteeringConsumed?: (admissionIds: string[]) => void
}

export interface AgentRunOptions extends AgentSteeringControls {
  apiUrl: string
  apiKey: string
  model: string
  modelRuntime?: AgentSkillRunOptions['modelRuntime']
  contextWindowTokens?: number
  contextRetentionMode?: AgentSkillRunOptions['contextRetentionMode']
  cachePriorityRetainedRuns?: AgentSkillRunOptions['cachePriorityRetainedRuns']
  systemPrompt?: string
  messages?: ChatCompletionMessage[]
  skill?: AgentSkillRunOptions['skill']
  userInput?: string
  resources?: SessionResource[]
  /** Per-conversation id for action-log persistence. Falls back to reqId. */
  sessionId?: string
  contextEpoch?: number
  projectRoot?: string
  projectName?: string
  /** Existing run checkpoint to continue without adding a new user message. */
  resumeFromRunId?: string
  resumeSourceSessionId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  promptAdmissionId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
}

export type AgentToolDiscovery = 'static' | 'dynamic'

export interface PrepareAgentRunDependencies {
  createActionLog?: (conversationId: string) => ActionLog
  loadRunCheckpoint?: typeof defaultLoadRunCheckpoint
  buildSkillMessages?: typeof defaultBuildSkillMessages
  prepareChatAgentMessages?: typeof defaultPrepareChatAgentMessages
  cloneMessagesForCheckpoint?: typeof defaultCloneMessagesForCheckpoint

  buildBranchForkPrompt?: typeof defaultBuildBranchForkPrompt
  injectPromptBeforeLatestUser?: typeof defaultInjectPromptBeforeLatestUser
  searchToolDefinitions?: typeof defaultSearchToolDefinitions
}

export interface PrepareAgentRunInput {
  reqId: string
  options: AgentRunOptions
  permissions?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
  dependencies?: PrepareAgentRunDependencies
}

export interface PreparedAgentRun {
  isSkill: boolean
  toolDiscovery: AgentToolDiscovery
  maxSteps: number
  skillTools: string[]
  toolScope: Set<string> | 'all'
  conversationId: string
  resumeSourceSessionId: string
  actionLog: ActionLog
  resumeCheckpoint?: RunCheckpoint
  resumeLoadError?: string
  messages: ChatCompletionMessage[]
  initialActiveTools: string[]
  ambiguousActions: AmbiguousAction[]
}

const RESOURCE_TOOL_NAMES = [
  'list_cached_resources',
  'read_cached_resource',
  'search_cached_resource'
]

export const clampMaxSteps = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) return 30
  return Math.max(1, Math.min(30, Math.floor(value)))
}

const appendUnique = (target: string[], values: string[]): void => {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value)
    }
  }
}

export function prepareAgentRun(input: PrepareAgentRunInput): PreparedAgentRun {
  const { reqId, options, permissions } = input
  const dependencies = input.dependencies || {}
  const createActionLog =
    dependencies.createActionLog ||
    ((conversationId: string): ActionLog => new ActionLog(getActionLogPath(conversationId)))
  const loadRunCheckpoint = dependencies.loadRunCheckpoint || defaultLoadRunCheckpoint
  const buildSkillMessages = dependencies.buildSkillMessages || defaultBuildSkillMessages
  const prepareChatAgentMessages =
    dependencies.prepareChatAgentMessages || defaultPrepareChatAgentMessages
  const cloneMessagesForCheckpoint =
    dependencies.cloneMessagesForCheckpoint || defaultCloneMessagesForCheckpoint
  const buildBranchForkPrompt = dependencies.buildBranchForkPrompt || defaultBuildBranchForkPrompt
  const injectPromptBeforeLatestUser =
    dependencies.injectPromptBeforeLatestUser || defaultInjectPromptBeforeLatestUser
  const searchToolDefinitions = dependencies.searchToolDefinitions || defaultSearchToolDefinitions

  const isSkill = !!options.skill
  const toolDiscovery: AgentToolDiscovery = isSkill
    ? options.skill!.toolDiscovery === 'dynamic'
      ? 'dynamic'
      : 'static'
    : 'dynamic'
  const maxSteps = isSkill ? clampMaxSteps(options.skill!.maxSteps) : 30
  const resourceToolNames =
    options.resources && options.resources.length > 0 ? RESOURCE_TOOL_NAMES : []
  const skillTools = isSkill
    ? Array.from(new Set([...(options.skill!.tools || []), ...resourceToolNames]))
    : []
  const toolScope = isSkill ? new Set<string>(skillTools) : 'all'

  const conversationId = options.sessionId || reqId
  const actionLog = createActionLog(conversationId)
  const resumeSourceSessionId = options.resumeSourceSessionId || conversationId
  const resumeCheckpoint = options.resumeFromRunId
    ? loadRunCheckpoint(resumeSourceSessionId, options.resumeFromRunId)
    : undefined

  const resumeLoadError =
    options.resumeFromRunId && !resumeCheckpoint
      ? `No resumable checkpoint found for run ${options.resumeFromRunId}. Regenerate the message if you want to start over.`
      : undefined

  let messages: ChatCompletionMessage[] = []
  if (resumeLoadError) {
    messages = []
  } else if (resumeCheckpoint) {
    messages = cloneMessagesForCheckpoint(resumeCheckpoint.messages)
  } else if (isSkill) {
    messages = buildSkillMessages({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemPrompt: options.systemPrompt,
      skill: options.skill!,
      userInput: options.userInput || '',
      resources: options.resources
    })
  } else {
    const baseMessages =
      options.contextRetentionMode === 'cache-priority' && options.cachePriorityRetainedRuns
        ? insertCachePriorityToolContext(options.messages || [], {
            sessionId: conversationId,
            retainedRuns: options.cachePriorityRetainedRuns,
            loadRunCheckpoint
          })
        : options.messages || []

    messages = prepareChatAgentMessages(
      baseMessages,
      options.systemPrompt,
      options.resources,
      permissions,
      options.projectRoot,
      options.projectName
    )
  }

  if (options.branchOf) {
    messages = injectPromptBeforeLatestUser(messages, buildBranchForkPrompt(options.branchOf))
  }

  const initialActiveTools = toolDiscovery === 'dynamic' ? ['search_tools'] : [...skillTools]
  if (resumeCheckpoint) {
    appendUnique(initialActiveTools, resumeCheckpoint.activeTools)
  }
  if (toolDiscovery === 'dynamic') {
    appendUnique(
      initialActiveTools,
      searchToolDefinitions('', 'all', permissions).map((summary) => summary.name)
    )
  }
  if (options.resources && options.resources.length > 0) {
    appendUnique(initialActiveTools, RESOURCE_TOOL_NAMES)
  }

  return {
    isSkill,
    toolDiscovery,
    maxSteps,
    skillTools,
    toolScope,
    conversationId,
    resumeSourceSessionId,
    actionLog,
    resumeCheckpoint,
    resumeLoadError,
    messages,
    initialActiveTools,
    ambiguousActions: [...(resumeCheckpoint?.ambiguousActions || [])]
  }
}
