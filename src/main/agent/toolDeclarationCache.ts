import { ChatToolDeclaration } from '../../shared/types'
import { toChatToolDeclaration } from '../toolRegistry'
import { ToolDefinition } from '../tools/types'
import { ToolRegistryView } from '../tools/registryView'
import { ToolPermission } from './toolCallPlanning'

export type ToolDiscoveryMode = 'static' | 'dynamic'

export interface ToolDeclarationCacheInput {
  toolDiscovery: ToolDiscoveryMode
  activeTools: Set<string>
  skillTools: string[]
  permissions?: Record<string, ToolPermission>
  toolRegistry?: ToolRegistryView
  registryRevision?: number
}

export interface CreateToolDeclarationCacheOptions {
  toolRegistry: ToolRegistryView
  toDeclaration?: (tool: ToolDefinition) => ChatToolDeclaration
}

export interface ToolDeclarationCache {
  getDeclarations(input: ToolDeclarationCacheInput): ChatToolDeclaration[]
}

const buildSignature = (input: ToolDeclarationCacheInput): string => {
  const active = Array.from(input.activeTools).sort().join(',')
  const skills = input.skillTools.slice().sort().join(',')
  const permissions = Object.entries(input.permissions || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([toolName, permission]) => `${toolName}:${permission}`)
    .join(',')

  return `${input.toolDiscovery}|registry=${input.registryRevision ?? 'live'}|active=${active}|skills=${skills}|permissions=${permissions}`
}

export function createToolDeclarationCache(
  options: CreateToolDeclarationCacheOptions
): ToolDeclarationCache {
  const toDeclaration = options.toDeclaration || toChatToolDeclaration
  let cachedDeclarations: ChatToolDeclaration[] | null = null
  let cachedSignature = ''

  return {
    getDeclarations(input): ChatToolDeclaration[] {
      const signature = buildSignature(input)
      if (cachedDeclarations && signature === cachedSignature) {
        return cachedDeclarations
      }

      const declarations: ChatToolDeclaration[] = []
      const toolRegistry = input.toolRegistry || options.toolRegistry
      for (const tool of toolRegistry.list()) {
        const toolName = tool.name
        if (!tool?.implemented) continue

        if (input.toolDiscovery === 'static') {
          if (!input.skillTools.includes(toolName)) continue
        } else if (!input.activeTools.has(toolName)) {
          continue
        }

        const permission = input.permissions?.[toolName] || 'allow'
        if (permission !== 'deny') {
          declarations.push(toDeclaration(tool))
        }
      }

      cachedDeclarations = declarations
      cachedSignature = signature
      return declarations
    }
  }
}
