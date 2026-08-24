import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from './types'
import { isToolCallConcurrencySafe } from './toolConcurrency'

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: 'test_tool',
  title: 'Test Tool',
  description: 'Test tool',
  tags: [],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ resultForModel: '', resultForUi: {} }),
  ...overrides
})

describe('tool concurrency policy', () => {
  it('allows built-in low-risk tools to overlap by default', () => {
    expect(isToolCallConcurrencySafe(tool(), {})).toBe(true)
  })

  it('keeps medium/high-risk and external tools exclusive by default', () => {
    expect(isToolCallConcurrencySafe(tool({ risk: 'medium' }), {})).toBe(false)
    expect(isToolCallConcurrencySafe(tool({ source: 'mcp' }), {})).toBe(false)
  })

  it('honors argument-aware overrides and fails closed when a classifier throws', () => {
    const dynamic = tool({ isConcurrencySafe: (args) => args.readOnly === true })
    expect(isToolCallConcurrencySafe(dynamic, { readOnly: true })).toBe(true)
    expect(isToolCallConcurrencySafe(dynamic, { readOnly: false })).toBe(false)
    expect(
      isToolCallConcurrencySafe(
        tool({
          isConcurrencySafe: () => {
            throw new Error('bad classifier')
          }
        }),
        {}
      )
    ).toBe(false)
  })
})
