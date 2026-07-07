import { ToolArgs } from '../../shared/types'
import { createToolResult } from './result'
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types'

export interface SubagentToolRequest {
  task: string
  context?: string
  tools?: string[]
  maxSteps: number
  label?: string
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
    label: toTrimmedString(args.label)
  }
}

export async function runSubagentTool(
  request: SubagentToolRequest,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { runSubagentTask } = await import('../agent/subagentRunner')
  return runSubagentTask(request, ctx)
}

export const subagentTool: ToolDefinition = {
  name: 'subagent',
  title: 'Delegate to Subagent',
  description:
    'Delegate a focused read-only research or code-inspection task to an isolated subagent. The subagent can use a bounded set of safe tools, cannot delegate again, and returns a concise result to the parent agent. Use this when a subtask can be investigated independently without modifying files or running shell commands.',
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
      }
    },
    required: ['task']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const request = normalizeSubagentRequest(args)
    try {
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
