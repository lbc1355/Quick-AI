import { describe, expect, it } from 'vitest'
import { resolveSubagentTools } from '../agent/subagentRunner'
import { normalizeSubagentRequest } from './subagentTool'
import { ToolRegistryView } from './registryView'
import { ToolDefinition } from './types'

const makeTool = (name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name,
  title: name,
  description: `${name} description`,
  tags: [],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ resultForModel: 'ok', resultForUi: { summary: 'ok' } }),
  ...overrides
})

const registryOf = (tools: ToolDefinition[]): ToolRegistryView => ({
  get: (name: string) => tools.find((tool) => tool.name === name),
  list: () => tools
})

describe('subagent tool', () => {
  it('normalizes request arguments and clamps max steps', () => {
    expect(
      normalizeSubagentRequest({
        task: '  inspect project  ',
        context: '  focus README  ',
        tools: ['file_read', 'file_read', '', 3],
        maxSteps: 99
      })
    ).toEqual({
      task: 'inspect project',
      context: 'focus README',
      tools: ['file_read'],
      maxSteps: 8
    })
  })

  it('requires a non-empty task', () => {
    expect(() => normalizeSubagentRequest({ task: '   ' })).toThrow('subagent requires')
  })

  it('filters unsafe, recursive, missing, and unimplemented tools', () => {
    const registry = registryOf([
      makeTool('file_read'),
      makeTool('shell', { category: 'shell', risk: 'high' }),
      makeTool('subagent', { category: 'system', risk: 'medium' }),
      makeTool('file_write', { risk: 'high' }),
      makeTool('broken_tool', { implemented: false })
    ])

    const result = resolveSubagentTools(registry, [
      'file_read',
      'shell',
      'subagent',
      'file_write',
      'broken_tool',
      'missing_tool'
    ])

    expect(result.tools.map((tool) => tool.name)).toEqual(['file_read'])
    expect(result.ignoredTools).toEqual([
      'shell',
      'subagent',
      'file_write',
      'broken_tool',
      'missing_tool'
    ])
  })
})
