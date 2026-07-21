import { describe, expect, it, vi } from 'vitest'
import { createSchema } from './schema'

describe('database schema', () => {
  it('persists split provider account and runtime metadata', () => {
    const exec = vi.fn()
    const database = {
      exec,
      prepare: vi.fn(() => ({ all: () => [] }))
    } as unknown as Parameters<typeof createSchema>[0]

    createSchema(database)
    const statements = exec.mock.calls.map(([statement]) => String(statement)).join('\n')

    for (const column of ['transportId', 'compatibility', 'authType', 'authHeader', 'headers']) {
      expect(statements).toContain(column)
    }
  })
})
