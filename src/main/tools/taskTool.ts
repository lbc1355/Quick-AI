import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { createTaskToolResult } from './taskResult'
import { normalizeTaskArgs } from './taskNormalization'
import { ToolDefinition, ToolExecutionContext } from './types'

export const taskTool: ToolDefinition = {
  name: 'task',
  title: 'Task Tracker',
  description:
    'Track progress on complex multi-step tasks. Create a structured task list at the start of non-trivial work and update individual step statuses as you go. The task list appears in the UI so the user can follow your progress. Tasks with duplicate IDs update the existing entry; new IDs are appended. Mark a task completed only after the underlying work has actually been performed.',
  tags: ['task', 'todo', 'plan', 'track', 'progress', '任务', '计划', '追踪'],
  category: 'system',
  risk: 'low',
  isConcurrencySafe: () => false,
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'Optional short single task title. Do not pass JSON, code, markdown, or a serialized task list here; use tasks for lists.'
      },
      title: {
        type: 'string',
        description:
          'Optional short single task title. Equivalent to task; useful when sending one task object.'
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description:
          'Optional status for a single task title. Defaults to in_progress for one task.'
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short stable id (e.g. "1", "search", "fix").' },
            title: { type: 'string', description: 'Brief description of this step.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              description: 'Current status.'
            }
          },
          required: ['id', 'title', 'status']
        },
        description:
          'The task list. Provide the COMPLETE list on first call; on subsequent calls only include items whose status changed. Use completed only after the work is actually done, not as a planning placeholder.'
      }
    }
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const incoming = normalizeTaskArgs(args)
    if (incoming.length === 0) {
      throw new Error(
        'No valid task items found. Expected { "tasks": [{ "id": "1", "title": "...", "status": "pending|in_progress|completed|cancelled" }] }, or a short single task title. Do not pass JSON/code as a task title.'
      )
    }

    const run = getRun(ctx.reqId)
    if (!run) {
      throw new Error('No active agent run - tasks are only available during an agent session.')
    }

    const merged = run.mergeTasks(incoming)

    ctx.emitEvent?.({ type: 'task_update' as const, tasks: merged })

    return createTaskToolResult(merged)
  }
}
