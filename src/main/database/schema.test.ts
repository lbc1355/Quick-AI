import { describe, expect, it, vi } from 'vitest'
import { createSchema } from './schema'

describe('database schema', () => {
  it('persists provider definitions and accounts separately', () => {
    const exec = vi.fn()
    const database = {
      exec,
      prepare: vi.fn(() => ({ all: () => [] }))
    } as unknown as Parameters<typeof createSchema>[0]

    createSchema(database)
    const statements = exec.mock.calls.map(([statement]) => String(statement)).join('\n')

    expect(statements).toContain('CREATE TABLE IF NOT EXISTS provider_definitions')
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS provider_accounts')
    expect(statements).toContain('providerId     TEXT NOT NULL REFERENCES provider_definitions')
    for (const column of ['transportId', 'compatibility', 'authType', 'authHeader', 'headers']) {
      expect(statements).toContain(column)
    }
  })
})
