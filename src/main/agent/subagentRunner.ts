import { ChatCompletionMessage, SubagentInnerEvent } from '../../shared/types'
import { getToolRegistryView } from '../toolRegistry'
import { createToolResult } from '../tools/result'
import {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  toChatToolDeclaration
} from '../tools/types'
import { ToolRegistryView } from '../tools/registryView'
import type { SubagentToolRequest } from '../tools/subagentTool'
import { getRun } from './AgentRunContext'
import { callModel } from './callModel'
import {
  DEFAULT_RESPONSE_RESERVE_RATIO,
  getContextWindowSize,
  getToolOutputSpilloverThreshold,
  normalizeContextWindowTokens,
  trimMessagesToFit
} from './contextManager'
import { DEFAULT_RETRY_POLICY } from './retryPolicy'
import { LoopGuard } from './loopGuard'
import { SIDE_EFFECTING_TOOLS } from './sideEffects'
import { runToolTurn } from './toolTurnRunner'
import { getMessageText } from './messageText'

const DEFAULT_SUBAGENT_TOOLS = [
  'file_read',
  'image_read',
  'code_symbol_read',
  'workspace_search',
  'workspace_list_files',
  'file_diff',
  'pdf_read',
  'web_search',
  'fetch_url',
  'click_link',
  'find_in_page',
  'list_cached_resources',
  'read_cached_resource',
  'search_cached_resource',
  'read_tool_output',
  'inspect_environment',
  'list_memory',
  'read_memory',
  'list_skills'
]

const BLOCKED_SUBAGENT_TOOLS = new Set([
  'subagent',
  'search_tools',
  'task',
  'ask_user_choice',
  'notify',
  'schedule_reminder',
  'list_reminders',
  'cancel_reminder',
  'workspace_add_root',
  'shell',
  'file_write',
  'file_edit',
  'multi_edit',
  'directory_create',
  'file_copy',
  'file_move',
  'file_delete',
  'write_memory',
  'delete_memory',
  'install_skill',
  'remove_skill',
  'create_skill',
  'validate_skill'
])

const MAX_TRANSCRIPT_LINES = 32
const MAX_OBSERVATION_PREVIEW = 600

export interface RunSubagentTaskDependencies {
  registry?: ToolRegistryView
  callModel?: typeof callModel
  runToolTurn?: typeof runToolTurn
  now?: () => number
}

interface SubagentToolObservation {
  step: number
  name: string
  content: string
}

const compact = (text: string): string => text.replace(/\s+/g, ' ').trim()

const summarize = (text: string, limit = MAX_OBSERVATION_PREVIEW): string => {
  const clean = compact(text)
  if (clean.length <= limit) return clean
  return `${clean.slice(0, Math.max(0, limit - 1))}…`
}

const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)))

function isSafeSubagentTool(tool: ToolDefinition): boolean {
  if (!tool.implemented) return false
  if (BLOCKED_SUBAGENT_TOOLS.has(tool.name)) return false
  if (tool.category === 'shell') return false
  if (tool.risk === 'high') return false
  if (SIDE_EFFECTING_TOOLS.has(tool.name)) return false
  return true
}

export function resolveSubagentTools(
  registry: ToolRegistryView,
  requestedTools?: string[]
): { tools: ToolDefinition[]; ignoredTools: string[] } {
  const names =
    requestedTools && requestedTools.length > 0 ? requestedTools : DEFAULT_SUBAGENT_TOOLS
  const tools: ToolDefinition[] = []
  const ignoredTools: string[] = []

  for (const name of unique(names)) {
    const tool = registry.get(name)
    if (tool && isSafeSubagentTool(tool)) {
      tools.push(tool)
    } else {
      ignoredTools.push(name)
    }
  }

  return { tools, ignoredTools }
}

function buildSubagentMessages(
  request: SubagentToolRequest,
  projectRoot?: string
): ChatCompletionMessage[] {
  const lines = [
    'You are a focused subagent running inside QuickAI.',
    'Work only on the delegated task. Use tools when they are helpful, but do not ask the user questions and do not attempt to modify files, run shell commands, schedule reminders, or delegate to another subagent.',
    "Return a concise final report with the answer, key evidence, and any uncertainty. Match the user's language when obvious."
  ]

  const userLines = [
    `Delegated task:\n${request.task}`,
    request.context ? `Additional context:\n${request.context}` : '',
    projectRoot ? `Current project root:\n${projectRoot}` : ''
  ].filter(Boolean)

  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: userLines.join('\n\n') }
  ]
}

function getEffectiveContextWindow(ctx: ToolExecutionContext): number {
  const model = ctx.agentModel
  if (!model) return getContextWindowSize('')
  return (
    normalizeContextWindowTokens(model.contextWindowTokens) ??
    normalizeContextWindowTokens(model.modelRuntime?.contextWindowTokens) ??
    getContextWindowSize(model.model)
  )
}

function buildChildPermissions(
  toolNames: string[],
  parentPolicy?: Record<string, 'allow' | 'ask' | 'deny'>
): Record<string, 'allow' | 'ask' | 'deny'> {
  const permissions: Record<string, 'allow' | 'ask' | 'deny'> = {}
  for (const name of toolNames) {
    permissions[name] = parentPolicy?.[name] === 'deny' ? 'deny' : 'allow'
  }
  return permissions
}

function formatResult(options: {
  request: SubagentToolRequest
  finalAnswer: string
  tools: ToolDefinition[]
  ignoredTools: string[]
  observations: SubagentToolObservation[]
  modelTurns: number
  durationMs: number
}): ToolExecutionResult {
  const usedNames = unique(options.observations.map((item) => item.name))
  const toolSummary = usedNames.length > 0 ? usedNames.join(', ') : 'none'
  const ignored = options.ignoredTools.length > 0 ? options.ignoredTools.join(', ') : 'none'
  const transcriptLines = options.observations.slice(0, MAX_TRANSCRIPT_LINES).map((item) => {
    return `Step ${item.step}: ${item.name} -> ${summarize(item.content)}`
  })
  const hiddenCount = Math.max(0, options.observations.length - transcriptLines.length)
  const details = [
    `Task:\n${options.request.task}`,
    options.request.context ? `Context:\n${options.request.context}` : '',
    `Model turns: ${options.modelTurns}`,
    `Duration: ${options.durationMs}ms`,
    `Available tools: ${options.tools.map((tool) => tool.name).join(', ') || 'none'}`,
    `Ignored tool requests: ${ignored}`,
    transcriptLines.length > 0
      ? `Internal tool observations:\n${transcriptLines.join('\n')}${hiddenCount > 0 ? `\n... ${hiddenCount} more observations omitted from UI preview.` : ''}`
      : 'Internal tool observations: none',
    `Final answer:\n${options.finalAnswer}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const resultForModel = [
    'Subagent completed.',
    `Task: ${options.request.task}`,
    `Tools used: ${toolSummary}`,
    options.ignoredTools.length > 0 ? `Ignored unsafe/unavailable tool requests: ${ignored}` : '',
    `Final answer:\n${options.finalAnswer}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return createToolResult({
    resultForModel,
    title: 'Subagent Result',
    summary: summarize(options.finalAnswer || `Completed with tools: ${toolSummary}`, 220),
    details
  })
}

export async function runSubagentTask(
  request: SubagentToolRequest,
  ctx: ToolExecutionContext,
  dependencies: RunSubagentTaskDependencies = {}
): Promise<ToolExecutionResult> {
  if (!ctx.agentModel) {
    throw new Error('Subagent cannot run because the current model configuration is unavailable.')
  }

  const parentRun = getRun(ctx.reqId)
  if (!parentRun) {
    throw new Error('Subagent can only run inside an active agent session.')
  }

  const registry = dependencies.registry || getToolRegistryView()
  const callModelFn = dependencies.callModel || callModel
  const runToolTurnFn = dependencies.runToolTurn || runToolTurn
  const now = dependencies.now || Date.now
  const startedAt = now()

  const { tools, ignoredTools } = resolveSubagentTools(registry, request.tools)
  const toolNames = tools.map((tool) => tool.name)
  const toolDeclarations = tools.map(toChatToolDeclaration)
  const childPermissions = buildChildPermissions(toolNames, parentRun.permissionPolicy)
  const activeTools = new Set(toolNames)
  const executedCalls = new Set<string>()
  const loopGuard = new LoopGuard()
  const fetchUrlBudget = { count: 0, max: 6 }
  const contextWindow = getEffectiveContextWindow(ctx)
  const outputSpilloverThreshold = getToolOutputSpilloverThreshold(contextWindow)
  const observations: SubagentToolObservation[] = []
  let messages = buildSubagentMessages(request, parentRun.projectRoot)
  let finalAnswer = ''
  let modelTurns = 0
  let halted = false

  const subagentId =
    ctx.callId || `subagent-${startedAt}-${Math.random().toString(36).substring(2, 11)}`

  ctx.emitEvent?.({
    type: 'subagent_start',
    subagentId,
    parentToolCallId: ctx.callId || '',
    label: request.label || (request.tools ? 'Custom' : 'General'),
    task: request.task,
    tools: toolNames,
    maxSteps: request.maxSteps
  })

  let runStatus: 'completed' | 'failed' | 'cancelled' | 'max_steps' = 'failed'
  let runErrorMsg: string | undefined

  try {
    for (let step = 1; step <= request.maxSteps; step++) {
      if (ctx.signal.aborted) throw new Error('Subagent execution aborted.')
      messages = trimMessagesToFit(messages, {
        maxTokens: contextWindow,
        reserveForResponseRatio: DEFAULT_RESPONSE_RESERVE_RATIO,
        strategy: 'truncate-oldest-tool',
        toolOutputSpilloverThreshold: outputSpilloverThreshold
      })

      const assistantMessage = await callModelFn(
        {
          apiUrl: ctx.agentModel.apiUrl,
          apiKey: ctx.agentModel.apiKey,
          providerConnection: ctx.agentModel.providerConnection,
          model: ctx.agentModel.model,
          modelRuntime: ctx.agentModel.modelRuntime,
          reasoningPreference: ctx.agentModel.reasoningPreference || 'auto'
        },
        messages,
        toolDeclarations.length > 0 ? toolDeclarations : undefined,
        ctx.signal,
        {
          onReasoning: (content) => {
            ctx.emitEvent?.({
              type: 'subagent_event',
              subagentId,
              event: {
                type: 'reasoning',
                content,
                step,
                stepId: `${ctx.callId || ctx.reqId}:subagent:${step}`
              }
            })
          },
          onFinalChunk: (content) => {
            ctx.emitEvent?.({
              type: 'subagent_event',
              subagentId,
              event: {
                type: 'agent_message_delta',
                content,
                step,
                stepId: `${ctx.callId || ctx.reqId}:subagent:${step}`
              }
            })
          }
        }
      )
      modelTurns++
      messages.push(assistantMessage)

      const toolCalls = assistantMessage.tool_calls || []
      if (toolCalls.length === 0) {
        finalAnswer = getMessageText(assistantMessage.content)
        runStatus = 'completed'
        break
      }

      const toolTurn = await runToolTurnFn({
        assistantMessage,
        assistantTextBuffer: getMessageText(assistantMessage.content),
        toolDiscovery: 'static',
        skillTools: toolNames,
        permissions: childPermissions,
        toolRegistry: registry,
        reqId: ctx.reqId,
        conversationId: parentRun.sessionId || ctx.reqId,
        step,
        maxSteps: request.maxSteps,
        stepId: `${ctx.callId || ctx.reqId}:subagent:${step}`,
        signal: ctx.signal,
        resources: ctx.resources,
        agentModel: ctx.agentModel,
        retryPolicy: DEFAULT_RETRY_POLICY,
        isSideEffecting: (toolName) => SIDE_EFFECTING_TOOLS.has(toolName),
        loopGuard,
        outputSpilloverThreshold,
        fetchUrlBudget,
        runContext: {
          activeTools,
          actionLog: parentRun.actionLog,
          projectRoot: parentRun.projectRoot,
          getAdditionalRootPaths: () => parentRun.getAdditionalRootPaths(),
          isToolActive: (toolName) => activeTools.has(toolName),
          isToolApproved: (toolName) => parentRun.isToolApproved(toolName),
          isCommandPrefixApproved: (command) => parentRun.isCommandPrefixApproved(command),
          hasExecuted: (callKey) => executedCalls.has(callKey),
          markExecuted: (callKey) => executedCalls.add(callKey),
          storeToolOutput: (callId, text) => parentRun.storeToolOutput(callId, text),
          activateTool: (toolName) => activeTools.add(toolName)
        },
        emitEvent: (innerEvent) => {
          ctx.emitEvent?.({
            type: 'subagent_event',
            subagentId,
            event: innerEvent as SubagentInnerEvent
          })
        },
        requestPermission: async () => false
      })

      messages.push(...toolTurn.messagesToAppend)
      for (const toolMessage of toolTurn.messagesToAppend) {
        if (toolMessage.role !== 'tool') continue
        observations.push({
          step,
          name: toolMessage.name || 'tool',
          content: typeof toolMessage.content === 'string' ? toolMessage.content : ''
        })
      }

      if (toolTurn.haltRequested) {
        halted = true
        break
      }
    }

    if (!finalAnswer) {
      messages.push({
        role: 'user',
        content: halted
          ? 'Tool use was halted. Provide the best final subagent report now without calling more tools.'
          : 'The subagent step limit was reached. Provide the best final subagent report now without calling more tools.'
      })
      const finalMessage = await callModelFn(
        {
          apiUrl: ctx.agentModel.apiUrl,
          apiKey: ctx.agentModel.apiKey,
          providerConnection: ctx.agentModel.providerConnection,
          model: ctx.agentModel.model,
          modelRuntime: ctx.agentModel.modelRuntime,
          reasoningPreference: ctx.agentModel.reasoningPreference || 'auto'
        },
        messages,
        undefined,
        ctx.signal,
        {
          onReasoning: (content) => {
            ctx.emitEvent?.({
              type: 'subagent_event',
              subagentId,
              event: {
                type: 'reasoning',
                content,
                step: request.maxSteps,
                stepId: `${ctx.callId || ctx.reqId}:subagent:final`
              }
            })
          },
          onFinalChunk: (content) => {
            ctx.emitEvent?.({
              type: 'subagent_event',
              subagentId,
              event: {
                type: 'agent_message_delta',
                content,
                step: request.maxSteps,
                stepId: `${ctx.callId || ctx.reqId}:subagent:final`
              }
            })
          }
        }
      )
      modelTurns++
      finalAnswer = getMessageText(finalMessage.content) || '[Subagent produced no final text.]'
      runStatus = halted ? 'failed' : 'max_steps'
    }
  } catch (error) {
    if (ctx.signal?.aborted || (error instanceof Error && error.message.includes('aborted'))) {
      runStatus = 'cancelled'
    } else {
      runStatus = 'failed'
    }
    runErrorMsg = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    ctx.emitEvent?.({
      type: 'subagent_end',
      subagentId,
      status: runStatus,
      finalAnswer,
      error: runErrorMsg,
      durationMs: now() - startedAt
    })
  }

  return formatResult({
    request,
    finalAnswer,
    tools,
    ignoredTools,
    observations,
    modelTurns,
    durationMs: now() - startedAt
  })
}
