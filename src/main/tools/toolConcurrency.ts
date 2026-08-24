import type { ToolArgs } from '../../shared/types'
import type { ToolDefinition } from './types'

/**
 * Built-in low-risk tools are read-like by default. Everything external or medium/high risk is
 * exclusive unless its definition explicitly opts a call into safe overlap.
 */
export function isToolCallConcurrencySafe(tool: ToolDefinition, args: ToolArgs): boolean {
  if (tool.isConcurrencySafe) {
    try {
      return tool.isConcurrencySafe(args) === true
    } catch {
      return false
    }
  }
  return (tool.source === undefined || tool.source === 'builtin') && tool.risk === 'low'
}
