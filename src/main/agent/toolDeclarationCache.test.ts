import { describe, expect, it, vi } from 'vitest'

import { ChatToolDeclaration } from '../../shared/types'
import { ToolDefinition } from '../tools/types'
import { ToolRegistryView } from '../tools/registryView'
import { createToolDeclarationCache } from './toolDeclarationCache'

const tool = (name: string, implemented = true): ToolDefinition => ({
  name,
  title: name,
  description: `${name} description`,
  tags: [],
  category: 'system',
  risk: 'low',
  implemented,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: async () => ({
    resultForModel: '',
    resultForUi: {
      title: name
    }
  })
})

const declarationFor = (definition: ToolDefinition): ChatToolDeclaration => ({
  type: 'function',
  function: {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters
  }
})

const registryOf = (tools: Record<string, ToolDefinition | undefined>): ToolRegistryView => ({
  get: (name) => tools[name],
  list: () => Object.values(tools).filter((tool): tool is ToolDefinition => !!tool)
})

describe('createToolDeclarationCache', () => {
  it('declares active implemented non-denied tools in dynamic mode', () => {
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({
        file_read: tool('file_read'),
        shell: tool('shell'),
        denied_tool: tool('denied_tool'),
        inactive_tool: tool('inactive_tool'),
        missing_impl: tool('missing_impl', false)
      }),
      toDeclaration: declarationFor
    })

    const declarations = cache.getDeclarations({
      toolDiscovery: 'dynamic',
      activeTools: new Set(['file_read', 'shell', 'denied_tool']),
      skillTools: [],
      permissions: {
        denied_tool: 'deny'
      }
    })

    expect(declarations.map((declaration) => declaration.function.name)).toEqual([
      'file_read',
      'shell'
    ])
  })

  it('declares only skill tools in static mode', () => {
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({
        file_read: tool('file_read'),
        shell: tool('shell')
      }),
      toDeclaration: declarationFor
    })

    const declarations = cache.getDeclarations({
      toolDiscovery: 'static',
      activeTools: new Set(['file_read', 'shell']),
      skillTools: ['shell']
    })

    expect(declarations.map((declaration) => declaration.function.name)).toEqual(['shell'])
  })

  it('accepts registry view sources', () => {
    const fileRead = tool('file_read')
    const shell = tool('shell')
    const cache = createToolDeclarationCache({
      toolRegistry: {
        get: (name) => (name === 'file_read' ? fileRead : name === 'shell' ? shell : undefined),
        list: () => [fileRead, shell]
      },
      toDeclaration: declarationFor
    })

    const declarations = cache.getDeclarations({
      toolDiscovery: 'dynamic',
      activeTools: new Set(['shell']),
      skillTools: []
    })

    expect(declarations.map((declaration) => declaration.function.name)).toEqual(['shell'])
  })

  it('reuses declarations while the declaration signature is unchanged', () => {
    const toDeclaration = vi.fn(declarationFor)
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({
        file_read: tool('file_read')
      }),
      toDeclaration
    })
    const input = {
      toolDiscovery: 'dynamic' as const,
      activeTools: new Set(['file_read']),
      skillTools: []
    }

    const first = cache.getDeclarations(input)
    const second = cache.getDeclarations(input)

    expect(second).toBe(first)
    expect(toDeclaration).toHaveBeenCalledTimes(1)
  })

  it('rebuilds declarations when active tools change', () => {
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({
        file_read: tool('file_read'),
        shell: tool('shell')
      }),
      toDeclaration: declarationFor
    })

    const first = cache.getDeclarations({
      toolDiscovery: 'dynamic',
      activeTools: new Set(['file_read']),
      skillTools: []
    })
    const second = cache.getDeclarations({
      toolDiscovery: 'dynamic',
      activeTools: new Set(['file_read', 'shell']),
      skillTools: []
    })

    expect(first.map((declaration) => declaration.function.name)).toEqual(['file_read'])
    expect(second.map((declaration) => declaration.function.name)).toEqual(['file_read', 'shell'])
    expect(second).not.toBe(first)
  })
})
