import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { createListSkillsTool } from './skillListTool'

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-demo',
  name: 'Demo Skill',
  trigger: 'demo',
  prompt: 'Run demo workflow.',
  description: 'Use demo workflow.',
  source: 'folder',
  filePath: 'D:\\skills\\demo\\SKILL.md',
  ...overrides
})

const executionContext = {
  reqId: 'test-req',
  signal: new AbortController().signal
}

describe('list skills tool', () => {
  it('lists installed skills using the shared list result formatter', async () => {
    const tool = createListSkillsTool({
      loadSkills: () => [makeSkill()]
    })

    const result = await tool.execute({}, executionContext)

    expect(result.resultForModel).toContain('Installed Skills:')
    expect(result.resultForModel).toContain('- ID: skill-demo')
    expect(result.resultForUi.title).toBe('List Skills')
    expect(result.resultForUi.summary).toBe('Found 1 skills')
    expect(result.resultForUi.items?.[0].title).toBe('Demo Skill')
  })

  it('returns full details for a specific skill and preserves missing skill error text', async () => {
    const tool = createListSkillsTool({
      loadSkills: () => [makeSkill()]
    })

    const result = await tool.execute({ skillId: 'skill-demo' }, executionContext)

    expect(result.resultForModel).toContain('Skill ID: skill-demo')
    expect(result.resultForModel).toContain('--- SKILL.md Prompt Instructions ---')
    expect(result.resultForUi.title).toBe('Skill Details: Demo Skill')
    expect(result.resultForUi.summary).toBe('Loaded details for skill skill-demo')

    await expect(tool.execute({ skillId: 'missing' }, executionContext)).rejects.toThrow(
      'Skill "missing" not found. Call list_skills without parameters to list all installed skills.'
    )
  })
})
