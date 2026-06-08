import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs, existsSync } from 'fs'
import {
  closeDb,
  addMemory,
  listMemories,
  searchMemories,
  deleteMemory,
  deleteSessionMemories
} from './database'
import { UserMemory } from '../shared/types'

const testDir = join(__dirname, '../../temp-user-memories-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

let seq = 0
function mem(partial: Partial<UserMemory>): UserMemory {
  seq += 1
  const now = 1_700_000_000_000 + seq * 1000
  return {
    id: partial.id ?? `m${seq}`,
    scope: partial.scope ?? 'global',
    sessionId: partial.sessionId,
    category: partial.category ?? 'general',
    content: partial.content ?? `memory ${seq}`,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  }
}

describe('user_memories DAL', () => {
  beforeEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
    seq = 0
  })

  afterEach(async () => {
    closeDb()
    if (existsSync(testDir)) await fs.rm(testDir, { recursive: true, force: true })
  })

  it('adds and lists a global memory', () => {
    addMemory(mem({ id: 'g1', scope: 'global', content: 'uses pnpm not npm' }))
    const all = listMemories({ scope: 'global' })
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('g1')
    expect(all[0].scope).toBe('global')
    expect(all[0].sessionId).toBeUndefined()
  })

  it('default scope returns global plus the current session, not other sessions', () => {
    addMemory(mem({ id: 'g1', scope: 'global' }))
    addMemory(mem({ id: 's-a', scope: 'session', sessionId: 'sess-A' }))
    addMemory(mem({ id: 's-b', scope: 'session', sessionId: 'sess-B' }))

    const ids = listMemories({ sessionId: 'sess-A' })
      .map((m) => m.id)
      .sort()
    expect(ids).toEqual(['g1', 's-a'])
  })

  it('with no sessionId, default scope returns only global', () => {
    addMemory(mem({ id: 'g1', scope: 'global' }))
    addMemory(mem({ id: 's-a', scope: 'session', sessionId: 'sess-A' }))
    expect(listMemories({}).map((m) => m.id)).toEqual(['g1'])
  })

  it('filters by category', () => {
    addMemory(mem({ id: 'p1', scope: 'global', category: 'preference' }))
    addMemory(mem({ id: 'f1', scope: 'global', category: 'fact' }))
    const prefs = listMemories({ scope: 'global', category: 'preference' })
    expect(prefs.map((m) => m.id)).toEqual(['p1'])
  })

  it('searches content with a case-insensitive substring match', () => {
    addMemory(mem({ id: 'g1', scope: 'global', content: 'Prefers Dark Mode' }))
    addMemory(mem({ id: 'g2', scope: 'global', content: 'lives in Berlin' }))
    expect(searchMemories('dark', { scope: 'global' }).map((m) => m.id)).toEqual(['g1'])
    expect(searchMemories('xyz', { scope: 'global' })).toHaveLength(0)
  })

  it('empty query falls back to listing', () => {
    addMemory(mem({ id: 'g1', scope: 'global' }))
    addMemory(mem({ id: 'g2', scope: 'global' }))
    expect(searchMemories('   ', { scope: 'global' })).toHaveLength(2)
  })

  it('orders by updatedAt descending', () => {
    addMemory(mem({ id: 'old', scope: 'global', updatedAt: 1000 }))
    addMemory(mem({ id: 'new', scope: 'global', updatedAt: 9000 }))
    expect(listMemories({ scope: 'global' }).map((m) => m.id)).toEqual(['new', 'old'])
  })

  it('deleteMemory removes a single memory', () => {
    addMemory(mem({ id: 'g1', scope: 'global' }))
    addMemory(mem({ id: 'g2', scope: 'global' }))
    deleteMemory('g1')
    expect(listMemories({ scope: 'global' }).map((m) => m.id)).toEqual(['g2'])
  })

  it('deleteSessionMemories removes only that session and never globals', () => {
    addMemory(mem({ id: 'g1', scope: 'global' }))
    addMemory(mem({ id: 's-a1', scope: 'session', sessionId: 'sess-A' }))
    addMemory(mem({ id: 's-a2', scope: 'session', sessionId: 'sess-A' }))
    addMemory(mem({ id: 's-b1', scope: 'session', sessionId: 'sess-B' }))

    const removed = deleteSessionMemories('sess-A')
    expect(removed).toBe(2)

    // Global survives; session B survives; session A gone.
    expect(listMemories({ scope: 'global' }).map((m) => m.id)).toEqual(['g1'])
    expect(listMemories({ scope: 'session', sessionId: 'sess-A' })).toHaveLength(0)
    expect(listMemories({ scope: 'session', sessionId: 'sess-B' }).map((m) => m.id)).toEqual([
      's-b1'
    ])
  })

  it('respects the limit cap', () => {
    for (let i = 0; i < 5; i++) addMemory(mem({ scope: 'global' }))
    expect(listMemories({ scope: 'global', limit: 2 })).toHaveLength(2)
  })
})
