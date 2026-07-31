import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { createResourceToolResult } from './resourceResult'
import { ToolDefinition, ToolExecutionContext } from './types'

export const toolOutputTools: Record<string, ToolDefinition> = {
  read_tool_output: {
    name: 'read_tool_output',
    title: 'Read Truncated Tool Output',
    description:
      'Retrieve the full text of an earlier tool result that was truncated to fit the context window. Use the output_id shown in the truncation marker; page through long output with offset.',
    tags: [
      'tool',
      'output',
      'truncated',
      'retrieve',
      'read',
      'history',
      '工具',
      '输出',
      '截断',
      '读取'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        output_id: {
          type: 'string',
          description: 'The id from the truncation marker (the originating tool call id).'
        },
        offset: {
          type: 'number',
          description: 'Starting character offset to read from. Defaults to 0.'
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to return in this window (1000-16000). Defaults to 8000.'
        }
      },
      required: ['output_id']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const outputId = typeof args.output_id === 'string' ? args.output_id : ''
      if (!outputId) {
        throw new Error('Missing or invalid output_id parameter')
      }

      const run = getRun(ctx.reqId)
      const full = run?.getToolOutput(outputId)
      if (full === undefined) {
        return createResourceToolResult({
          resultForModel: `No stored tool output found for output_id "${outputId}". It may have expired or never been preserved.`,
          title: `Read Tool Output: ${outputId}`,
          summary: 'No stored output found'
        })
      }

      const rawOffset =
        typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0
      const offset = Math.max(0, Math.min(Math.floor(rawOffset), full.length))
      const rawMax =
        typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) ? args.maxChars : 8000
      const maxChars = Math.min(16000, Math.max(1000, Math.floor(rawMax)))

      const slice = full.slice(offset, offset + maxChars)
      const endOffset = offset + slice.length
      const nextOffset = endOffset < full.length ? endOffset : undefined

      const header = `Tool output ${outputId} (chars ${offset}-${endOffset} of ${full.length})${
        nextOffset !== undefined ? `\nMore available: call again with offset=${nextOffset}.` : ''
      }`

      return createResourceToolResult({
        resultForModel: `${header}\n\nContent:\n${slice}`,
        title: `Read Tool Output: ${outputId}`,
        summary: `Returned chars ${offset}-${endOffset} of ${full.length}`
      })
    }
  }
}
