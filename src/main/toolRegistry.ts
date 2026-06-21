// ---- Tools ----
// Tool definitions are authored in per-category modules under tools/ and registered into a
// dynamic registry. The registry supports runtime addition/removal so that external tools (MCP
// servers, plugins) can be loaded alongside built-ins.
//
// ToolRegistry is a legacy Proxy that supports `ToolRegistry[name]` dot/bracket access and
// `for...in` iteration for backward compatibility. New production code should use the explicit
// view/admin APIs below instead of depending on the Proxy shape.

import { ToolArgs } from '../shared/types'
import { getRun } from './agent/AgentRunContext'
import { ToolDefinition, ToolExecutionContext, ToolSummary } from './tools/types'
import { ToolRegistryImpl, createRegistryProxy } from './tools/registry'
import { ToolRegistryView } from './tools/registryView'
import { webTools } from './tools/web'
import { systemTools } from './tools/system'
import { memoryTools } from './tools/memory'
import { fileTools } from './tools/file'
import { shellTools } from './tools/shell'

export type { ToolExecutionContext, ToolDefinition, ToolSummary } from './tools/types'
export { toChatToolDeclaration } from './tools/types'
export { getWorkspaceRoot, isPathInWorkspace, isSensitiveFile, escapeRegExp } from './tools/helpers'
export type { ToolArgs }

// ---- Registry instance ----

const registry = new ToolRegistryImpl()
registry.loadBuiltins([webTools, systemTools, memoryTools, fileTools, shellTools])

// The search_tools meta-tool is the only tool not in a category module — it references the
// registry directly and lives here to avoid a circular dependency.
const searchToolsDef: ToolDefinition = {
  name: 'search_tools',
  title: 'Search Tools',
  description: 'Search the tool registry for available tools that can help with the user request.',
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
    const matchedSummaries = registry.search(query, scope, permissionPolicy)

    if (runCtx) {
      matchedSummaries.forEach((t) => {
        runCtx.activateTool(t.name)
        const fullToolDef = registry.get(t.name)
        if (fullToolDef && fullToolDef.dependencies) {
          fullToolDef.dependencies.forEach((dep) => {
            const depDef = registry.get(dep)
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

// Register search_tools so it is discoverable (indirectly, via its own search) and
// executable. It must be in the registry before the Proxy is created.
registry.register(searchToolsDef)

// ---- Public API ----

/**
 * Legacy dynamic tool registry. Supports `ToolRegistry[name]` bracket access and `for...in`
 * iteration for backward compatibility with older tests and direct tool invocations.
 * New production code should use getToolRegistryView(), getToolRegistryAdmin(), or
 * registerToolDefinition()/unregisterToolDefinition().
 */
export const ToolRegistry = createRegistryProxy(registry)

/** Register an external tool at runtime (e.g. from an MCP server). */
export const registerToolDefinition = (def: ToolDefinition): void => registry.register(def)

/** Unregister a tool. Returns true when the tool existed and was removed. */
export const unregisterToolDefinition = (name: string): boolean => registry.unregister(name)

/** Read-only registry view for agent execution and UI listing code. */
export const getToolRegistryView = (): ToolRegistryView => registry

/** The underlying registry instance for management code that must register/search/mutate. */
export const getToolRegistryAdmin = (): ToolRegistryImpl => registry

/** @deprecated Use registerToolDefinition. */
export const registerTool = registerToolDefinition

/** @deprecated Use unregisterToolDefinition. */
export const unregisterTool = unregisterToolDefinition

/** @deprecated Use getToolRegistryView or getToolRegistryAdmin. */
export const getToolRegistry = getToolRegistryAdmin

/**
 * Search discoverable tools by keyword. Delegates to the registry's search.
 * (Kept as a standalone function for backward compatibility with agentLoop / messageBuilder.)
 */
export function searchToolDefinitions(
  query: string,
  scope?: Set<string> | 'all',
  permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
): ToolSummary[] {
  return registry.search(query, scope, permissionPolicy)
}
