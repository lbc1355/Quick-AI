import { ToolDefinition, ToolSummary } from './types'
import { normalizeToolDefinition } from './metadata'

/**
 * Dynamically-registerable tool registry. Replaces the old static `Record<string, ToolDefinition>`
 * so that external tools (MCP servers, plugins) can be registered at runtime alongside built-ins.
 *
 * A Proxy wrapper provides backward-compatible `ToolRegistry[name]` bracket/dot access and
 * `for...in` iteration so existing consumers in agentLoop, toolCallPlanning, and tests continue
 * to work without changes.
 */
export class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>()

  // ---- mutation ----

  register(def: ToolDefinition): void {
    const normalized = normalizeToolDefinition(def)
    this.tools.set(normalized.name, normalized)
  }

  /** Remove a tool. Returns true when the tool existed and was removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /** Register every built-in tool from category modules. Idempotent. */
  loadBuiltins(categoryModules: Array<Record<string, ToolDefinition>>): void {
    for (const mod of categoryModules) {
      for (const def of Object.values(mod)) {
        this.register(def)
      }
    }
  }

  // ---- query ----

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** All tool names (for iteration / Proxy ownKeys). */
  toolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  /** All tool definitions. */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /** Search tools by query, respecting scope and permissions. */
  search(
    query: string,
    scope?: Set<string> | 'all',
    permissionPolicy?: { [toolName: string]: 'allow' | 'ask' | 'deny' }
  ): ToolSummary[] {
    const cleanQuery = query.toLowerCase().trim()

    if (cleanQuery === '') {
      const matched: ToolSummary[] = []
      for (const tool of this.tools.values()) {
        if (!tool.discoverable || !tool.implemented) continue
        if (scope && scope !== 'all' && !scope.has(tool.name)) continue
        const permission = permissionPolicy?.[tool.name] || 'allow'
        if (permission === 'deny') continue
        matched.push(this.summarize(tool, permission))
      }
      return matched
    }

    const queryWords = cleanQuery.split(/\s+/).filter(Boolean)
    const resultsWithScore: Array<{ tool: ToolSummary; score: number }> = []

    for (const tool of this.tools.values()) {
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
          tool: this.summarize(tool, permission),
          score
        })
      }
    }

    resultsWithScore.sort((a, b) => b.score - a.score)
    return resultsWithScore.map((r) => r.tool)
  }

  private summarize(tool: ToolDefinition, permission: string): ToolSummary {
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      category: tool.category,
      risk: tool.risk,
      permission
    }
  }
}

/**
 * Create a Proxy that makes a ToolRegistryImpl quack like the legacy
 * `Record<string, ToolDefinition>` — dot/bracket access returns tools by name,
 * and `for...in` / `Object.keys()` enumerate tool names.
 */
export function createRegistryProxy(registry: ToolRegistryImpl): Record<string, ToolDefinition> {
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && target.has(prop)) {
        return target.get(prop)
      }
      return Reflect.get(target, prop, receiver)
    },

    ownKeys(target) {
      return target.toolNames()
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && target.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          writable: false
        }
      }
      return undefined
    }
  }) as unknown as Record<string, ToolDefinition>
}
