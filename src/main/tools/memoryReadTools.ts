import { ToolArgs } from '../../shared/types'
import {
  getTaskGroup,
  listRolloutSummaries,
  listTaskGroups,
  readAlways,
  readRaw,
  readRolloutSummary,
  readSummaryIndex
} from '../memory/memoryStore'
import { createMemoryToolResult } from './memoryResult'
import { ToolDefinition } from './types'

export const memoryReadTools: Record<string, ToolDefinition> = {
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
        return createMemoryToolResult({
          resultForModel: readAlways() || '(always.md is empty)',
          title: 'Read Memory',
          summary: 'always.md'
        })
      }
      if (target.toLowerCase() === 'summary') {
        return createMemoryToolResult({
          resultForModel: readSummaryIndex() || '(memory_summary.md is empty)',
          title: 'Read Memory',
          summary: 'memory_summary.md'
        })
      }
      if (target.toLowerCase() === 'raw') {
        return createMemoryToolResult({
          resultForModel: readRaw() || '(raw_memories.md is empty)',
          title: 'Read Memory',
          summary: 'raw_memories.md'
        })
      }
      if (target.toLowerCase().startsWith('rollout:')) {
        const file = target.slice('rollout:'.length).trim()
        const content = readRolloutSummary(file)
        return createMemoryToolResult({
          resultForModel: content || `No rollout summary named "${file}".`,
          title: 'Read Memory',
          summary: `rollout: ${file}`
        })
      }

      const group = getTaskGroup(target)
      if (!group) {
        const names = listTaskGroups().map((g) => g.name)
        return createMemoryToolResult({
          resultForModel:
            `No Task Group named "${target}".` +
            (names.length
              ? ` Available: ${names.join(', ')}.`
              : ' The memory library has no task groups yet.'),
          title: 'Read Memory',
          summary: `Not found: ${target}`
        })
      }
      return createMemoryToolResult({
        resultForModel: group.raw,
        title: 'Read Memory',
        summary: `Task Group: ${group.name}`
      })
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
          lines.push(`- ${g.name}${g.scope ? ` - ${g.scope}` : ''}`)
        }
      }
      if (rollouts.length > 0) {
        lines.push('', `Rollout summaries (${rollouts.length}, newest first):`)
        for (const r of rollouts.slice(0, 20)) lines.push(`- ${r}`)
      }
      return createMemoryToolResult({
        resultForModel: lines.join('\n'),
        title: 'List Memory',
        summary: `${groups.length} group(s), ${rollouts.length} rollout(s)`
      })
    }
  }
}
