import { describe, expect, it } from 'vitest'

import { ToolDefinition } from './types'
import { normalizeToolDefinition } from './metadata'

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: ' test_tool ',
  title: ' Test Tool ',
  description: ' Test description ',
  tags: [' file ', 'file', '', 'read'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' }
    },
    required: ['path']
  },
  execute: async () => ({
    resultForModel: 'ok',
    resultForUi: {
      title: 'ok'
    }
  }),
  ...overrides
})

describe('normalizeToolDefinition', () => {
  it('normalizes stable metadata and defaults source to builtin', () => {
    const normalized = normalizeToolDefinition(tool())

    expect(normalized).toMatchObject({
      name: 'test_tool',
      title: 'Test Tool',
      description: 'Test description',
      tags: ['file', 'read'],
      source: 'builtin',
      category: 'file',
      risk: 'low'
    })
  })

  it('normalizes malformed parameter schemas to object parameters', () => {
    const normalized = normalizeToolDefinition(
      tool({
        parameters: {
          type: 'object',
          properties: undefined as never,
          required: ['path', 1] as never
        }
      })
    )

    expect(normalized.parameters).toEqual({
      type: 'object',
      properties: {},
      required: ['path']
    })
  })

  it('rejects invalid controlled metadata', () => {
    expect(() => normalizeToolDefinition(tool({ category: 'database' as never }))).toThrow(
      'invalid category'
    )
    expect(() => normalizeToolDefinition(tool({ risk: 'extreme' as never }))).toThrow(
      'invalid risk'
    )
    expect(() => normalizeToolDefinition(tool({ source: 'unknown' as never }))).toThrow(
      'invalid source'
    )
  })
})
