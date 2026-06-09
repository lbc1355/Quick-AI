import { describe, expect, it } from 'vitest'
import { buildMemoryContextPrompt, injectMemoryContext } from './memoryPrompts'
import { UserMemory } from '../../shared/types'

const memory = (partial: Partial<UserMemory>): UserMemory => ({
  id: partial.id || 'mem-1',
  scope: partial.scope || 'global',
  category: partial.category || 'general',
  content: partial.content || 'remembered fact',
  sessionId: partial.sessionId,
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
