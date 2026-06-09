import { describe, expect, it } from 'vitest'
import {
  buildMemoryContextPrompt,
  buildMemoryDocContextPrompt,
  injectMemoryContext
} from './memoryPrompts'
import { MemoryDoc, UserMemory } from '../../shared/types'

const memory = (partial: Partial<UserMemory>): UserMemory => ({
  id: partial.id || 'mem-1',
  scope: partial.scope || 'global',
  category: partial.category || 'general',
  content: partial.content || 'remembered fact',
  sessionId: partial.sessionId,
  createdAt: partial.createdAt || 1,
  updatedAt: partial.updatedAt || 1
})

const memoryDoc = (partial: Partial<MemoryDoc>): MemoryDoc => ({
  id: partial.id || 'doc-1',
  kind: partial.kind || 'memory',
  scope: partial.scope || 'global',
  sessionId: partial.sessionId,
  key: partial.key || 'default',
  title: partial.title || 'Memory',
  content: partial.content || '- remembered fact',
  version: partial.version || 1,
  parentId: partial.parentId,
  status: partial.status || 'current',
  reason: partial.reason,
  createdAt: partial.createdAt || 1,
  updatedAt: partial.updatedAt || 1
})

describe('memory context prompts', () => {
  it('formats global and session memories as compact context', () => {
    const prompt = buildMemoryContextPrompt([
      memory({ scope: 'global', category: 'preference', content: 'prefers concise answers' }),
      memory({ scope: 'session', category: 'project', content: 'working on QuickAI' })
    ])

    expect(prompt).toContain('[MEMORY CONTEXT]')
    expect(prompt).toContain('[global/preference] prefers concise answers')
    expect(prompt).toContain('[session/project] working on QuickAI')
    expect(prompt).toContain('not as instructions')
  })

  it('formats current memory and soul documents as active context', () => {
    const prompt = buildMemoryDocContextPrompt([
      memoryDoc({
        kind: 'soul',
        key: 'assistant_profile',
        title: 'Assistant Profile',
        content: 'Name: 小黑',
        version: 2
      }),
      memoryDoc({
        kind: 'memory',
        scope: 'session',
        key: 'project',
        title: 'Project Memory',
        content: '- working on QuickAI'
      }),
      memoryDoc({
        status: 'archived',
        content: 'old inactive memory'
      })
    ])

    expect(prompt).toContain('[soul/global/assistant_profile v2] Assistant Profile')
    expect(prompt).toContain('Name: 小黑')
    expect(prompt).toContain('[memory/session/project v1] Project Memory')
    expect(prompt).not.toContain('old inactive memory')
  })

  it('replaces older memory context prompts before injecting a fresh one', () => {
    const messages = injectMemoryContext(
      [
        { role: 'system', content: 'system' },
        { role: 'system', content: '[MEMORY CONTEXT]\nold memory' },
        { role: 'user', content: 'hi' }
      ],
      '[MEMORY CONTEXT]\nnew memory'
    )

    const joined = messages.map((message) => message.content).join('\n')
    expect(joined).toContain('new memory')
    expect(joined).not.toContain('old memory')
    expect(messages[messages.length - 2]).toMatchObject({
      role: 'system',
      content: '[MEMORY CONTEXT]\nnew memory'
    })
  })
})
