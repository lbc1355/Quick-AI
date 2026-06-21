import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { ToolDefinition, ToolExecutionContext } from './types'
import { createMemoryToolResult } from './memoryResult'

export const memoryActionTools: Record<string, ToolDefinition> = {
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
        throw new Error('No active agent run found - action log is only available during an agent session.')
      }
      const list = run.actionLog.list({
        toolName: typeof args.toolName === 'string' ? args.toolName : undefined,
        fromTurn: typeof args.fromTurn === 'number' ? args.fromTurn : undefined,
        toTurn: typeof args.toTurn === 'number' ? args.toTurn : undefined,
        limit: typeof args.limit === 'number' ? Math.min(50, Math.max(1, args.limit)) : 20
      })

      if (list.length === 0) {
        return createMemoryToolResult({
          resultForModel: 'No past actions found in this conversation yet.',
          title: 'Past Actions',
          summary: 'No actions recorded yet'
        })
      }

      const lines = [`Past tool actions (${list.length} shown, newest first):`, '']
      list.forEach((a, i) => {
        lines.push(
          `${i + 1}. [Turn ${a.turnIndex}] ${a.toolName} - ${a.resultStatus} (${a.durationMs}ms, ${a.resultSize} chars)`
        )
        lines.push(`   callId: ${a.callId}`)
        if (a.resultInOutputStore) {
          lines.push(
            `   Full output preserved - use get_past_action("${a.callId}") or read_tool_output for full text.`
          )
        }
        lines.push(`   Summary: ${a.resultSummary.slice(0, 200)}`)
        lines.push('')
      })
      lines.push('To inspect a specific action in full, call get_past_action with its callId.')

      return createMemoryToolResult({
        resultForModel: lines.join('\n'),
        title: 'Past Actions',
        summary: `Listed ${list.length} past tool actions`
      })
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
        return createMemoryToolResult({
          resultForModel: `No action found with callId "${callId}". It may be from a different conversation or have been evicted from the log.`,
          title: `Past Action: ${callId}`,
          summary: 'Not found'
        })
      }

      const argsStr = JSON.stringify(record.args, null, 2)
      const retrievalHint = record.resultInOutputStore
        ? `\nFull result is preserved in the output store. Call read_tool_output(output_id="${record.callId}") to read it.`
        : ''
      const resultForModel = [
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
      ].join('\n')

      return createMemoryToolResult({
        resultForModel,
        title: `Past Action: ${record.toolName}`,
        summary: `Turn ${record.turnIndex} - ${record.resultStatus} (${record.durationMs}ms)`
      })
    }
  }
}
