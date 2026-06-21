import { describe, expect, it } from 'vitest'

import { ToolDefinition } from './types'
import { toToolRegistryView } from './registryView'

const tool = (name: string): ToolDefinition => ({
  name,
  title: name,
  description: `${name} description`,
  tags: [],
  category: 'system',
  risk: 'low',
  implemented: true,
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

describe('toToolRegistryView', () => {
  it('adapts legacy record-shaped registries', () => {
    const fileRead = tool('file_read')
    const view = toToolRegistryView({
      file_read: fileRead,
      missing: undefined
    })

    expect(view.get('file_read')).toBe(fileRead)
    expect(view.get('missing')).toBeUndefined()
    expect(view.list()).toEqual([fileRead])
  })

  it('returns registry-view sources unchanged', () => {
    const view = {
      get: () => undefined,
      list: () => []
    }

    expect(toToolRegistryView(view)).toBe(view)
  })
})
