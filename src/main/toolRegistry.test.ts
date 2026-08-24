import { afterEach, describe, expect, it } from 'vitest'

import {
  getToolRegistryAdmin,
  getToolRegistryView,
  registerToolDefinition,
  replaceToolDefinitions,
  unregisterToolDefinition
} from './toolRegistry'
import { ToolDefinition } from './tools/types'
import { materializeToolRegistry } from './tools/registryView'

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
    for (const name of getToolRegistryAdmin().toolNames()) {
      if (name.startsWith(testToolName)) unregisterToolDefinition(name)
    }
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

  it('marks a materialized tool as stale when the live definition is replaced', () => {
    registerToolDefinition(testTool)
    const snapshot = materializeToolRegistry(getToolRegistryView())

    expect(snapshot.resolve(testToolName)).toMatchObject({
      status: 'current',
      tool: { title: 'Registry View Test Tool' }
    })

    registerToolDefinition({ ...testTool, title: 'Replacement Tool' })

    expect(snapshot.get(testToolName)?.title).toBe('Registry View Test Tool')
    expect(snapshot.resolve(testToolName)).toEqual({ status: 'stale' })

    const nextSnapshot = materializeToolRegistry(getToolRegistryView())
    expect(nextSnapshot.revision).toBeGreaterThan(snapshot.revision)
    expect(nextSnapshot.resolve(testToolName)).toMatchObject({
      status: 'current',
      tool: { title: 'Replacement Tool' }
    })
  })

  it('replaces an owned tool generation atomically and preserves stable name positions', () => {
    const secondName = `${testToolName}_second`
    const unrelatedName = `${testToolName}_unrelated`
    registerToolDefinition(testTool)
    registerToolDefinition({ ...testTool, name: secondName, title: 'Second Tool' })
    registerToolDefinition({ ...testTool, name: unrelatedName, title: 'Unrelated Tool' })

    replaceToolDefinitions(
      [testToolName, secondName],
      [
        { ...testTool, name: testToolName, title: 'Replacement Tool' },
        { ...testTool, name: `${testToolName}_fresh`, title: 'Fresh Tool' }
      ]
    )

    const names = getToolRegistryAdmin()
      .toolNames()
      .filter((name) => name.startsWith(testToolName))
    expect(names).toEqual([testToolName, unrelatedName, `${testToolName}_fresh`])
    expect(getToolRegistryAdmin().get(testToolName)?.title).toBe('Replacement Tool')
    expect(getToolRegistryAdmin().has(secondName)).toBe(false)
    expect(getToolRegistryAdmin().get(unrelatedName)?.title).toBe('Unrelated Tool')
  })

  it('keeps the previous generation when any replacement definition is invalid', () => {
    registerToolDefinition(testTool)
    const before = getToolRegistryAdmin().materialize()

    expect(() =>
      replaceToolDefinitions(
        [testToolName],
        [
          { ...testTool, title: 'Would Replace' },
          { ...testTool, name: `${testToolName}_invalid`, title: '' }
        ]
      )
    ).toThrow('title cannot be empty')

    expect(getToolRegistryAdmin().get(testToolName)?.title).toBe('Registry View Test Tool')
    expect(getToolRegistryAdmin().materialize().revision).toBe(before.revision)
  })

  it('refuses to overwrite a tool outside the replaced owner set', () => {
    const unrelatedName = `${testToolName}_unrelated`
    registerToolDefinition(testTool)
    registerToolDefinition({ ...testTool, name: unrelatedName, title: 'Unrelated Tool' })
    const before = getToolRegistryAdmin().materialize()

    expect(() =>
      replaceToolDefinitions(
        [testToolName],
        [{ ...testTool, name: unrelatedName, title: 'Owner Collision' }]
      )
    ).toThrow('would overwrite an unowned tool')

    expect(getToolRegistryAdmin().get(testToolName)?.title).toBe('Registry View Test Tool')
    expect(getToolRegistryAdmin().get(unrelatedName)?.title).toBe('Unrelated Tool')
    expect(getToolRegistryAdmin().materialize().revision).toBe(before.revision)
  })
})
