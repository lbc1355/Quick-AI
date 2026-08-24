import { AgentEvent, SubagentLifecycleEvent, ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { createToolResult } from './result'
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types'

export interface SubagentToolRequest {
  task: string
  context?: string
  tools?: string[]
  maxSteps: number
  label?: string
  background: boolean
}

const DEFAULT_MAX_STEPS = 4
const MAX_STEPS_LIMIT = 8
const MAX_TOOL_NAMES = 24

const toTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const normalizeToolNames = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const names = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(names)).slice(0, MAX_TOOL_NAMES)
}

const normalizeMaxSteps = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_STEPS
  return Math.min(MAX_STEPS_LIMIT, Math.max(1, Math.floor(value)))
}

export function normalizeSubagentRequest(args: ToolArgs): SubagentToolRequest {
  const task = toTrimmedString(args.task)
  if (!task) {
    throw new Error('subagent requires a non-empty task string.')
  }

  return {
    task,
    context: toTrimmedString(args.context),
    tools: normalizeToolNames(args.tools),
    maxSteps: normalizeMaxSteps(args.maxSteps),
    label: toTrimmedString(args.label),
    background: args.background === true
  }
}

export async function runSubagentTool(
  request: SubagentToolRequest,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { runSubagentTask } = await import('../agent/subagentRunner')
  return runSubagentTask(request, ctx)
}

const backgroundJobId = (ctx: ToolExecutionContext): string =>
  `background-subagent-${ctx.reqId}-${ctx.callId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const isSubagentLifecycleEvent = (event: AgentEvent): event is SubagentLifecycleEvent =>
  event.type === 'subagent_start' ||
  event.type === 'subagent_event' ||
  event.type === 'subagent_end'

async function startBackgroundSubagent(
  request: SubagentToolRequest,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  if (!ctx.host?.publishBackgroundSubagentCompletion) {
    throw new Error('Background subagent delivery is unavailable in this host.')
  }

  const [{ startBackgroundJob, updateBackgroundJob }, { runSubagentTask }] = await Promise.all([
    import('../agent/backgroundJobManager'),
    import('../agent/subagentRunner')
  ])
  const jobId = backgroundJobId(ctx)
  const parentRun = getRun(ctx.reqId)
  let backgroundEventSequence = 0
  let completionEvent:
    | Extract<import('../../shared/types').AgentEvent, { type: 'subagent_end' }>
    | undefined

  startBackgroundJob({
    id: jobId,
    type: 'subagent',
    title: request.label || request.task,
    description: request.task,
    sessionId: parentRun?.sessionId,
    run: async (signal) => {
      let result: ToolExecutionResult | undefined
      let failure: unknown
      try {
        result = await runSubagentTask(request, {
          ...ctx,
          signal,
          emitEvent: (event) => {
            if (!isSubagentLifecycleEvent(event)) {
              ctx.emitEvent?.(event)
              return
            }
            backgroundEventSequence += 1
            const normalizedEvent: SubagentLifecycleEvent = {
              ...event,
              runId: jobId,
              sequence: backgroundEventSequence,
              timestamp: event.timestamp ?? Date.now()
            }
            if (normalizedEvent.type === 'subagent_end') completionEvent = normalizedEvent
            if (ctx.host?.publishBackgroundSubagentEvent) {
              ctx.host.publishBackgroundSubagentEvent({ jobId, event: normalizedEvent })
            } else {
              ctx.emitEvent?.(normalizedEvent)
            }
          }
        })
      } catch (error) {
        failure = error
      }

      const fallbackError =
        failure instanceof Error ? failure.message : failure ? String(failure) : undefined
      const status = completionEvent?.status || (signal.aborted ? 'cancelled' : 'failed')
      const persistedResult = result?.resultForModel || completionEvent?.finalAnswer
      const persistedError = completionEvent?.error || fallbackError
      updateBackgroundJob(jobId, {
        ...(persistedResult !== undefined ? { output: persistedResult } : {}),
        ...(persistedError ? { error: persistedError } : {})
      })
      try {
        ctx.host?.publishBackgroundSubagentCompletion?.({
          jobId,
          subagentId: completionEvent?.subagentId || ctx.callId || jobId,
          parentToolCallId: ctx.callId || '',
          task: request.task,
          label: request.label || (request.tools ? 'Custom' : 'General'),
          status,
          result: persistedResult,
          error: persistedError,
          durationMs: completionEvent?.durationMs
        })
      } finally {
        parentRun?.actionLog.save()
      }

      if (failure) throw failure
      return { status, ...(completionEvent?.error ? { error: completionEvent.error } : {}) }
    }
  })

  return createToolResult({
    resultForModel: [
      `Background subagent started with jobId ${jobId}.`,
      'It will report back automatically when finished. Do not poll it or duplicate its task.',
      'Continue with independent, non-overlapping work.'
    ].join('\n'),
    title: 'Background Subagent Started',
    summary: `Running in background: ${request.label || request.task}`,
    details: `Job ID: ${jobId}\n\nTask:\n${request.task}`
  })
}

export const subagentTool: ToolDefinition = {
  name: 'subagent',
  title: 'Delegate to Subagent',
  description:
    'Delegate a focused read-only research or code-inspection task to an isolated subagent. Set background=true only for independent work: it returns immediately and reports the result automatically when finished. Foreground remains the default when the result is needed before continuing.',
  tags: ['agent', 'subagent', 'delegate', 'parallel', 'research', 'inspect', '子任务', '子agent'],
  category: 'system',
  risk: 'medium',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'The focused task for the subagent. Include the concrete question or investigation goal.'
      },
      context: {
        type: 'string',
        description:
          'Optional extra context, constraints, file paths, URLs, or assumptions the subagent should consider.'
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional safe tool names to expose to the subagent. Unknown, high-risk, shell, mutation, and recursive tools are ignored. Omit to use the default read-only tool set.'
      },
      maxSteps: {
        type: 'number',
        description: 'Maximum model/tool iterations for the subagent. Default 4, maximum 8.'
      },
      label: {
        type: 'string',
        description:
          'Optional short role/label for this subagent, e.g. "General", "Research", "Coder".'
      },
      background: {
        type: 'boolean',
        description:
          'Optional. Run asynchronously and return immediately. The result is delivered automatically; do not poll. Defaults to false.'
      }
    },
    required: ['task']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const request = normalizeSubagentRequest(args)
    try {
      if (request.background) return await startBackgroundSubagent(request, ctx)
      return await runSubagentTool(request, ctx)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return createToolResult({
        resultForModel: `Subagent failed: ${message}`,
        title: 'Subagent Failed',
        summary: message,
        details: `Task:\n${request.task}\n\nError:\n${message}`
      })
    }
  }
}
