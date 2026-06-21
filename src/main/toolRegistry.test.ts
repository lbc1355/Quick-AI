import { afterEach, describe, expect, it } from 'vitest'

import {
  getToolRegistryAdmin,
  getToolRegistryView,
  registerToolDefinition,
  unregisterToolDefinition
} from './toolRegistry'
import { ToolDefinition } from './tools/types'

const testToolName = '__test_registry_view_tool'

const testTool: ToolDefinition = {
  name: testToolName,
  title: 'Registry View Test Tool',
  description: 'Used by registry API tests.',
  tags: ['test'],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: async () => ({
    resultForModel: 'ok',
    resultForUi: {
      title: 'ok'
    }
  })
}

describe('toolRegistry public APIs', () => {
  afterEach(() => {
    unregisterToolDefinition(testToolName)
  })

  it('exposes registered tools through the read-only view and admin registry', () => {
    registerToolDefinition(testTool)

    expect(getToolRegistryView().get(testToolName)).toMatchObject({
      name: testToolName,
      title: 'Registry View Test Tool',
      source: 'builtin'
    })
    expect(getToolRegistryView().list()).toContainEqual(
      expect.objectContaining({
        name: testToolName,
        source: 'builtin'
      })
    )
    expect(getToolRegistryAdmin().has(testToolName)).toBe(true)

    expect(unregisterToolDefinition(testToolName)).toBe(true)
    expect(getToolRegistryView().get(testToolName)).toBeUndefined()
  })
})
