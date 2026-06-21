import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { createSkillReadTools } from './skillReadTools'

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-rich',
  name: 'Rich Skill',
  trigger: 'rich',
  prompt: 'Follow the rich workflow.',
  description: 'Use rich workflow.',
  packageFiles: [],
  ...overrides
})

const executionContext = {
  reqId: 'test-req',
  signal: new AbortController().signal
}

describe('skill read tools', () => {
  it('loads skill instructions with auxiliary resource paths but not resource content', async () => {
    const tools = createSkillReadTools({
      loadSkills: () => [
        makeSkill({
          packageFiles: [
            { path: 'references/notes.md', content: 'Reference details', size: 17 }
          ]
        })
      ]
    })

    const result = await tools.load_skill.execute({ name: '@rich' }, executionContext)

    expect(result.resultForModel).toContain('Loaded QuickAI Skill')
    expect(result.resultForModel).toContain('Rich Skill')
    expect(result.resultForModel).toContain('Packaged Auxiliary Files:')
    expect(result.resultForModel).toContain('Path: references/notes.md')
    expect(result.resultForModel).toContain('read_skill_resource')
    expect(result.resultForModel).not.toContain('Reference details')
    expect(result.resultForUi.title).toBe('Load Skill: Rich Skill')
  })

  it('reads resource content with clamped paging metadata', async () => {
    const content = '0123456789'.repeat(120)
    const tools = createSkillReadTools({
      loadSkills: () => [
        makeSkill({
          packageFiles: [{ path: 'references/notes.md', content, size: content.length }]
        })
      ]
    })

    const result = await tools.read_skill_resource.execute(
      { name: 'rich', path: '\\references\\notes.md', offset: 100, maxChars: 100 },
      executionContext
    )

    expect(result.resultForModel).toContain('Skill Resource: skill-rich')
    expect(result.resultForModel).toContain('Path: references/notes.md')
    expect(result.resultForModel).toContain('Chars: 100-1100 of 1200')
    expect(result.resultForModel).toContain('More available: call again with offset=1100.')
    expect(result.resultForUi.summary).toBe('skill-rich chars 100-1100')
  })

  it('reports available resources when a requested resource is missing', async () => {
    const tools = createSkillReadTools({
      loadSkills: () => [
        makeSkill({
          packageFiles: [
            { path: 'agents/quickai.yaml', content: 'hidden', size: 6 },
            { path: 'references/notes.md', content: 'Reference details', size: 17 }
          ]
        })
      ]
    })

    await expect(
      tools.read_skill_resource.execute(
        { name: '@rich', path: 'references/missing.md' },
        executionContext
      )
    ).rejects.toThrow(
      'Resource "references/missing.md" not found in skill-rich. Available resources: references/notes.md'
    )
  })
})
