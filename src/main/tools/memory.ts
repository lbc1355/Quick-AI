import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getRun } from '../agent/AgentRunContext'
import {
  readAlways,
  readSummaryIndex,
  readRaw,
  listTaskGroups,
  getTaskGroup,
  listRolloutSummaries,
  readRolloutSummary,
  setAlways,
  writeTaskGroup,
  appendRaw,
  writeRolloutSummary,
  deleteTaskGroup
} from '../memory/memoryStore'

export const memoryTools: Record<string, ToolDefinition> = {
  list_past_actions: {
    name: 'list_past_actions',
    title: 'List Past Tool Actions',
    description:
      'Browse your own tool call history for this conversation. Returns a list of recent actions (tool name, turn index, status, result summary). Use this to recall what you have already tried before repeating work or asking the user. Optionally filter by tool name, turn range, or limit.',
    tags: ['memory', 'history', 'actions', 'audit', 'log', '历史', '记录', '操作'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description:
            'Optional filter: only return actions for this tool (e.g. "fetch_url", "web_search").'
        },
        fromTurn: {
          type: 'number',
          description: 'Optional filter: only return actions from this turn index onward.'
        },
        toTurn: {
          type: 'number',
          description: 'Optional filter: only return actions up to this turn index.'
        },
        limit: {
          type: 'number',
          description: 'Maximum actions to return (1-50, default 20).'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const run = getRun(ctx.reqId)
      if (!run) {
        throw new Error(
          'No active agent run found — action log is only available during an agent session.'
        )
      }
      const list = run.actionLog.list({
        toolName: typeof args.toolName === 'string' ? args.toolName : undefined,
        fromTurn: typeof args.fromTurn === 'number' ? args.fromTurn : undefined,
        toTurn: typeof args.toTurn === 'number' ? args.toTurn : undefined,
        limit: typeof args.limit === 'number' ? Math.min(50, Math.max(1, args.limit)) : 20
      })

      if (list.length === 0) {
        return {
          resultForModel: 'No past actions found in this conversation yet.',
          resultForUi: {
            title: 'Past Actions',
            summary: 'No actions recorded yet'
          }
        }
      }

      const lines = [`Past tool actions (${list.length} shown, newest first):`, '']
      list.forEach((a, i) => {
        lines.push(
          `${i + 1}. [Turn ${a.turnIndex}] ${a.toolName} — ${a.resultStatus} (${a.durationMs}ms, ${a.resultSize} chars)`
        )
        lines.push(`   callId: ${a.callId}`)
        if (a.resultInOutputStore) {
          lines.push(
            `   Full output preserved — use get_past_action("${a.callId}") or read_tool_output for full text.`
          )
        }
        lines.push(`   Summary: ${a.resultSummary.slice(0, 200)}`)
        lines.push('')
      })
      lines.push('To inspect a specific action in full, call get_past_action with its callId.')

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'Past Actions',
          summary: `Listed ${list.length} past tool actions`
        }
      }
    }
  },
  get_past_action: {
    name: 'get_past_action',
    title: 'Get Past Action Detail',
    description:
      'Retrieve the full record of a specific past tool call, including its arguments and complete result summary. Use this after list_past_actions to inspect a particular action in detail.',
    tags: ['memory', 'history', 'detail', 'audit', 'log', '历史', '详情', '操作'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        callId: {
          type: 'string',
          description: 'The callId of the past action to retrieve (from list_past_actions).'
        }
      },
      required: ['callId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const callId = typeof args.callId === 'string' ? args.callId : ''
      if (!callId) {
        throw new Error('Missing or invalid callId parameter')
      }
      const run = getRun(ctx.reqId)
      if (!run) {
        throw new Error('No active agent run found.')
      }
      const record = run.actionLog.get(callId)
      if (!record) {
        return {
          resultForModel: `No action found with callId "${callId}". It may be from a different conversation or have been evicted from the log.`,
          resultForUi: {
            title: `Past Action: ${callId}`,
            summary: 'Not found'
          }
        }
      }

      const argsStr = JSON.stringify(record.args, null, 2)
      const retrievalHint = record.resultInOutputStore
        ? `\nFull result is preserved in the output store. Call read_tool_output(output_id="${record.callId}") to read it.`
        : ''

      return {
        resultForModel: [
          `Action Detail for callId: ${record.callId}`,
          `Tool: ${record.toolName}`,
          `Turn: ${record.turnIndex}`,
          `Status: ${record.resultStatus}`,
          `Permission: ${record.permission}`,
          `Duration: ${record.durationMs}ms`,
          `Result size: ${record.resultSize} chars`,
          `Arguments:`,
          argsStr,
          `Result summary (first 500 chars):`,
          record.resultSummary,
          retrievalHint
        ].join('\n'),
        resultForUi: {
          title: `Past Action: ${record.toolName}`,
          summary: `Turn ${record.turnIndex} — ${record.resultStatus} (${record.durationMs}ms)`
        }
      }
    }
  },
  read_memory: {
    name: 'read_memory',
    title: 'Read Memory',
    description:
      'Read durable memory from the on-disk Markdown library. Pass target="<Task Group name>" to read one on-demand knowledge group (names come from the on-demand index injected into your system prompt or from list_memory). Pass target="always" for the constant memory, target="summary" for the index, target="raw" for raw sediment, or target="rollout:<filename>" for a specific rollout summary.',
    tags: ['memory', 'read', 'recall', 'task group', '记忆', '读取', '回忆'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'What to read: a Task Group name, or one of "always", "summary", "raw", "rollout:<filename>".'
        }
      },
      required: ['target']
    },
    execute: async (args: ToolArgs) => {
      const target = typeof args.target === 'string' ? args.target.trim() : ''
      if (!target) throw new Error('Missing or invalid target parameter')

      if (target.toLowerCase() === 'always') {
        return {
          resultForModel: readAlways() || '(always.md is empty)',
          resultForUi: { title: 'Read Memory', summary: 'always.md' }
        }
      }
      if (target.toLowerCase() === 'summary') {
        return {
          resultForModel: readSummaryIndex() || '(memory_summary.md is empty)',
          resultForUi: { title: 'Read Memory', summary: 'memory_summary.md' }
        }
      }
      if (target.toLowerCase() === 'raw') {
        return {
          resultForModel: readRaw() || '(raw_memories.md is empty)',
          resultForUi: { title: 'Read Memory', summary: 'raw_memories.md' }
        }
      }
      if (target.toLowerCase().startsWith('rollout:')) {
        const file = target.slice('rollout:'.length).trim()
        const content = readRolloutSummary(file)
        return {
          resultForModel: content || `No rollout summary named "${file}".`,
          resultForUi: { title: 'Read Memory', summary: `rollout: ${file}` }
        }
      }

      const group = getTaskGroup(target)
      if (!group) {
        const names = listTaskGroups().map((g) => g.name)
        return {
          resultForModel:
            `No Task Group named "${target}".` +
            (names.length
              ? ` Available: ${names.join(', ')}.`
              : ' The memory library has no task groups yet.'),
          resultForUi: { title: 'Read Memory', summary: `Not found: ${target}` }
        }
      }
      return {
        resultForModel: group.raw,
        resultForUi: { title: 'Read Memory', summary: `Task Group: ${group.name}` }
      }
    }
  },
  list_memory: {
    name: 'list_memory',
    title: 'List Memory',
    description:
      'List the on-demand memory index: every Task Group name with its scope, plus the available rollout summaries. Use this to decide what to read_memory.',
    tags: ['memory', 'list', 'index', 'task group', '记忆', '列表', '索引'],
    category: 'memory',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      const groups = listTaskGroups()
      const rollouts = listRolloutSummaries()
      const lines: string[] = []
      if (groups.length === 0) {
        lines.push('No Task Groups stored yet.')
      } else {
        lines.push(`Task Groups (${groups.length}):`)
        for (const g of groups) {
          lines.push(`- ${g.name}${g.scope ? ` — ${g.scope}` : ''}`)
        }
      }
      if (rollouts.length > 0) {
        lines.push('', `Rollout summaries (${rollouts.length}, newest first):`)
        for (const r of rollouts.slice(0, 20)) lines.push(`- ${r}`)
      }
      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'List Memory',
          summary: `${groups.length} group(s), ${rollouts.length} rollout(s)`
        }
      }
    }
  },
  write_memory: {
    name: 'write_memory',
    title: 'Write Memory',
    description:
      'Persist durable memory to the on-disk Markdown library (git-versioned). Only write stable, reusable knowledge or long-term user preferences — never one-off task context or unverified guesses. target="task_group" (default) writes/replaces a Task Group block in MEMORY.md and refreshes the index; provide group_name and the full block content. target="always" overwrites the constant memory (use sparingly, keep it short). target="rollout" creates a provenance summary for a finished task (provide group_name as a slug). target="raw" appends to raw sediment.',
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
        return {
          resultForModel: 'Updated always.md (constant memory). Committed to git.',
          resultForUi: { title: 'Write Memory', summary: 'Updated always.md' }
        }
      }
      if (target === 'raw') {
        await appendRaw(content)
        return {
          resultForModel: 'Appended to raw_memories.md. Committed to git.',
          resultForUi: { title: 'Write Memory', summary: 'Appended raw memory' }
        }
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
        return {
          resultForModel: `Wrote rollout summary ${file}. Committed to git.`,
          resultForUi: { title: 'Write Memory', summary: `Rollout: ${file}` }
        }
      }

      // task_group (default)
      if (!groupName) {
        throw new Error('group_name is required when writing a Task Group.')
      }
      await writeTaskGroup(groupName, content)
      return {
        resultForModel: `Wrote Task Group "${groupName}" to MEMORY.md and refreshed the index. Committed to git.`,
        resultForUi: { title: 'Write Memory', summary: `Task Group: ${groupName}` }
      }
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
        return {
          resultForModel: `Successfully deleted Task Group "${groupName}" from MEMORY.md and rebuilt the index. Committed to git.`,
          resultForUi: { title: 'Delete Memory', summary: `Deleted Task Group: ${groupName}` }
        }
      }
      return {
        resultForModel: `No Task Group named "${groupName}" was found in the memory library.`,
        resultForUi: { title: 'Delete Memory', summary: `Not found: ${groupName}` }
      }
    }
  }
}
