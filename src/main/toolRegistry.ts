// ---- Tools ----
// Tool definitions are authored in per-category modules under tools/ and aggregated here.
// Types, shared helpers, and search infrastructure also live here so external consumers have a
// single import surface.

import { ToolArgs, ChatToolDeclaration } from '../shared/types'
import { getRun } from './agent/AgentRunContext'
import { ToolDefinition, ToolExecutionContext, ToolSummary } from './tools/types'
import { webTools } from './tools/web'
import { systemTools } from './tools/system'
import { memoryTools } from './tools/memory'
import { fileTools } from './tools/file'
import { shellTools } from './tools/shell'

export type { ToolExecutionContext, ToolDefinition, ToolSummary } from './tools/types'
export { toChatToolDeclaration } from './tools/types'
export { getWorkspaceRoot, isPathInWorkspace, isSensitiveFile, escapeRegExp } from './tools/helpers'
export type { ToolArgs }
export type { ChatToolDeclaration }

// ---- Aggregated registry ----

export const ToolRegistry: Record<string, ToolDefinition> = {
  ...webTools,
  ...systemTools,
  ...memoryTools,
  ...fileTools,
  ...shellTools,
  search_tools: {
    name: 'search_tools',
    title: 'Search Tools',
    description:
      'Search the tool registry for available tools that can help with the user request.',
    tags: ['meta', 'utility', 'find', 'discovery'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: false,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query to search for tools (e.g., "web search" or "file read").'
        }
      },
      required: ['query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const query = (args.query as string) || ''
      const runCtx = getRun(ctx.reqId)
      const scope = runCtx ? runCtx.toolScope : 'all'
      const permissionPolicy = runCtx?.permissionPolicy
      const matchedSummaries = searchToolDefinitions(query, scope, permissionPolicy)

      if (runCtx) {
        matchedSummaries.forEach((t) => {
          runCtx.activateTool(t.name)
          const fullToolDef = ToolRegistry[t.name]
          if (fullToolDef && fullToolDef.dependencies) {
            fullToolDef.dependencies.forEach((dep) => {
              const depDef = ToolRegistry[dep]
              if (!depDef || !depDef.implemented) return
              if (scope !== 'all' && !scope.has(dep)) return
              const permission = permissionPolicy?.[dep] || 'allow'
              if (permission === 'deny') return

              runCtx.activateTool(dep)
            })
          }
        })
      }

      const observation =
        matchedSummaries.length > 0
          ? JSON.stringify(matchedSummaries, null, 2)
          : `No discoverable tools matched query: "${query}"`

      return {
        resultForModel: observation,
        resultForUi: {
          title: `Search Tools: "${query}"`,
          summary: `Discovered ${matchedSummaries.length} tools: ${matchedSummaries.map((m) => m.name).join(', ')}`
        }
      }
    }
  }
}

// ---- Search ----

export function searchToolDefinitions(
  query: string,
  scope?: Set<string> | 'all',
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): ToolSummary[] {
  const cleanQuery = query.toLowerCase().trim()
  if (cleanQuery === '') {
    const matched: ToolSummary[] = []
    for (const key in ToolRegistry) {
      const tool = ToolRegistry[key]
      if (!tool.discoverable || !tool.implemented) continue
      if (scope && scope !== 'all' && !scope.has(tool.name)) continue
      const permission = permissionPolicy?.[tool.name] || 'allow'
      if (permission === 'deny') continue
      matched.push({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        permission
      })
    }
    return matched
  }

  const queryWords = cleanQuery.split(/\s+/).filter(Boolean)
  const resultsWithScore: Array<{ tool: ToolSummary; score: number }> = []

  for (const key in ToolRegistry) {
    const tool = ToolRegistry[key]
    if (!tool.discoverable || !tool.implemented) continue
    if (scope && scope !== 'all' && !scope.has(tool.name)) continue

    const permission = permissionPolicy?.[tool.name] || 'allow'
    if (permission === 'deny') continue

    const matchText =
      `${tool.name} ${tool.title} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase()

    let score = 0
    for (const word of queryWords) {
      if (matchText.includes(word)) {
        score += 10
      } else {
        if (word.endsWith('s') && matchText.includes(word.slice(0, -1))) {
          score += 8
        } else if (matchText.includes(word + 's')) {
          score += 8
        }

        const isChinese = /[一-龥]/.test(word)
        if (isChinese) {
          const chars = [...word]
          let charMatchCount = 0
          for (const char of chars) {
            if (matchText.includes(char)) {
              charMatchCount++
            }
          }
          if (charMatchCount > 0) {
            score += Math.round((charMatchCount / chars.length) * 5)
          }
        }
      }
    }

    if (score > 0) {
      resultsWithScore.push({
        tool: {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          category: tool.category,
          risk: tool.risk,
          permission
        },
        score
      })
    }
  }

  resultsWithScore.sort((a, b) => b.score - a.score)
  return resultsWithScore.map((r) => r.tool)
}
