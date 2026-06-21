import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import {
  appendRaw,
  deleteTaskGroup,
  setAlways,
  writeRolloutSummary,
  writeTaskGroup
} from '../memory/memoryStore'
import { createMemoryToolResult } from './memoryResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const memoryWriteTools: Record<string, ToolDefinition> = {
  write_memory: {
    name: 'write_memory',
    title: 'Write Memory',
    description:
      'Persist durable memory to the on-disk Markdown library (git-versioned). Only write stable, reusable knowledge or long-term user preferences - never one-off task context or unverified guesses. target="task_group" (default) writes/replaces a Task Group block in MEMORY.md and refreshes the index; provide group_name and the full block content. target="always" overwrites the constant memory (use sparingly, keep it short). target="rollout" creates a provenance summary for a finished task (provide group_name as a slug). target="raw" appends to raw sediment.',
    tags: ['memory', 'write', 'remember', 'persist', 'task group', '记忆', '写入', '记住'],
    category: 'memory',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['task_group', 'always', 'rollout', 'raw'],
          description: 'Where to write. Default: task_group.'
        },
        group_name: {
          type: 'string',
          description:
            'For target="task_group": the Task Group name (created or replaced). For target="rollout": a short slug for the filename.'
        },
        content: {
          type: 'string',
          description:
            'The Markdown content to write. For task_group, the full group body (a "# Task Group:" header is added if absent).'
        },
        reason: {
          type: 'string',
          description: 'Short reason for the write (used in the rollout header / commit context).'
        }
      },
      required: ['content']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (!content) throw new Error('Missing or invalid content parameter')
      const MAX_CHARS = 30000
      if (content.length > MAX_CHARS) {
        throw new Error(
          `Memory content is too long (${content.length} chars). Keep it under ${MAX_CHARS} characters.`
        )
      }
      const target = typeof args.target === 'string' ? args.target : 'task_group'
      const groupName = typeof args.group_name === 'string' ? args.group_name.trim() : ''

      if (target === 'always') {
        await setAlways(content)
        return createMemoryToolResult({
          resultForModel: 'Updated always.md (constant memory). Committed to git.',
          title: 'Write Memory',
          summary: 'Updated always.md'
        })
      }
      if (target === 'raw') {
        await appendRaw(content)
        return createMemoryToolResult({
          resultForModel: 'Appended to raw_memories.md. Committed to git.',
          title: 'Write Memory',
          summary: 'Appended raw memory'
        })
      }
      if (target === 'rollout') {
        const run = getRun(ctx.reqId)
        const slug = groupName || 'task'
        const file = await writeRolloutSummary(
          {
            threadId: run?.sessionId,
            updatedAt: new Date().toISOString(),
            outcome: typeof args.reason === 'string' ? args.reason : undefined,
            slug
          },
          content
        )
        return createMemoryToolResult({
          resultForModel: `Wrote rollout summary ${file}. Committed to git.`,
          title: 'Write Memory',
          summary: `Rollout: ${file}`
        })
      }

      if (!groupName) {
        throw new Error('group_name is required when writing a Task Group.')
      }
      await writeTaskGroup(groupName, content)
      return createMemoryToolResult({
        resultForModel: `Wrote Task Group "${groupName}" to MEMORY.md and refreshed the index. Committed to git.`,
        title: 'Write Memory',
        summary: `Task Group: ${groupName}`
      })
    }
  },
  delete_memory: {
    name: 'delete_memory',
    title: 'Delete Memory',
    description:
      'Delete a specific Task Group from the on-demand Markdown memory library. Returns success message or a warning if the group was not found.',
    tags: ['memory', 'delete', 'forget', 'task group', '记忆', '删除', '忘记'],
    category: 'memory',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        group_name: {
          type: 'string',
          description: 'The name of the Task Group to delete.'
        }
      },
      required: ['group_name']
    },
    execute: async (args: ToolArgs) => {
      const groupName = typeof args.group_name === 'string' ? args.group_name.trim() : ''
      if (!groupName) throw new Error('Missing or invalid group_name parameter')
      const success = await deleteTaskGroup(groupName)
      if (success) {
        return createMemoryToolResult({
          resultForModel: `Successfully deleted Task Group "${groupName}" from MEMORY.md and rebuilt the index. Committed to git.`,
          title: 'Delete Memory',
          summary: `Deleted Task Group: ${groupName}`
        })
      }
      return createMemoryToolResult({
        resultForModel: `No Task Group named "${groupName}" was found in the memory library.`,
        title: 'Delete Memory',
        summary: `Not found: ${groupName}`
      })
    }
  }
}
