import { describe, expect, it, vi } from 'vitest'

import { ChatToolDeclaration } from '../../shared/types'
import { ToolDefinition } from '../tools/types'
import { ToolRegistryView } from '../tools/registryView'
import { createToolDeclarationCache, hashToolDeclarations } from './toolDeclarationCache'

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

  it('rebuilds declarations when the materialized registry revision changes', () => {
    const firstTool = tool('file_read')
    const replacementTool = {
      ...tool('file_read'),
      description: 'replacement description'
    }
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({ file_read: firstTool }),
      toDeclaration: declarationFor
    })
    const baseInput = {
      toolDiscovery: 'dynamic' as const,
      activeTools: new Set(['file_read']),
      skillTools: []
    }

    const first = cache.getDeclarations({
      ...baseInput,
      toolRegistry: registryOf({ file_read: firstTool }),
      registryRevision: 1
    })
    const second = cache.getDeclarations({
      ...baseInput,
      toolRegistry: registryOf({ file_read: replacementTool }),
      registryRevision: 2
    })

    expect(first[0].function.description).toBe('file_read description')
    expect(second[0].function.description).toBe('replacement description')
    expect(second).not.toBe(first)
  })

  it('sorts declarations by name regardless of registry insertion order', () => {
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({
        shell: tool('shell'),
        file_read: tool('file_read'),
        edit: tool('edit')
      }),
      toDeclaration: declarationFor
    })

    const declarations = cache.getDeclarations({
      toolDiscovery: 'dynamic',
      activeTools: new Set(['shell', 'file_read', 'edit']),
      skillTools: []
    })

    expect(declarations.map((declaration) => declaration.function.name)).toEqual([
      'edit',
      'file_read',
      'shell'
    ])
  })

  it('keeps declaration bytes stable across registry orderings (prompt-cache prefix)', () => {
    const cache = createToolDeclarationCache({
      toolRegistry: registryOf({ a: tool('a'), b: tool('b'), c: tool('c') }),
      toDeclaration: declarationFor
    })
    const baseInput = {
      toolDiscovery: 'dynamic' as const,
      activeTools: new Set(['a', 'b', 'c']),
      skillTools: []
    }

    // Same tool set, different insertion order + a registry revision bump forces a rebuild.
    const first = cache.getDeclarations({
      ...baseInput,
      toolRegistry: registryOf({ a: tool('a'), b: tool('b'), c: tool('c') }),
      registryRevision: 1
    })
    const second = cache.getDeclarations({
      ...baseInput,
      toolRegistry: registryOf({ c: tool('c'), a: tool('a'), b: tool('b') }),
      registryRevision: 2
    })

    expect(second).not.toBe(first)
    expect(second.map((declaration) => declaration.function.name)).toEqual(['a', 'b', 'c'])
    // The wire serialization that reaches the provider must not depend on registry order.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(hashToolDeclarations(second)).toBe(hashToolDeclarations(first))
  })
})
