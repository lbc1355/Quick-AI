import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { createValidateSkillTool } from './skillValidationTool'

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-demo',
  name: 'Demo Skill',
  trigger: 'demo',
  prompt: 'Run demo workflow.',
  description: 'Use demo workflow.',
  ...overrides
})

const executionContext = {
  reqId: 'test-req',
  signal: new AbortController().signal
}

describe('validate skill tool', () => {
  it('validates all skills with the existing model and UI shape', async () => {
    const tool = createValidateSkillTool({
      loadSkills: () => [
        makeSkill(),
        makeSkill({
          id: 'skill-empty',
          name: '',
          trigger: 'empty',
          prompt: '',
          description: ''
        })
      ]
    })

    const result = await tool.execute({}, executionContext)

    expect(result.resultForModel).toContain('Skill Validation:')
    expect(result.resultForModel).toContain('- skill-demo (@demo): OK')
    expect(result.resultForModel).toContain('- skill-empty (@empty): Issues')
    expect(result.resultForModel).toContain('Missing skill name.')
    expect(result.resultForUi.title).toBe('Validate Skills')
    expect(result.resultForUi.summary).toBe('2 skill(s), 3 issue(s)')
  })

  it('validates a single named skill and rejects missing names', async () => {
    const tool = createValidateSkillTool({
      loadSkills: () => [makeSkill()]
    })

    const result = await tool.execute({ name: '@demo' }, executionContext)

    expect(result.resultForModel).toContain('- skill-demo (@demo): OK')
    expect(result.resultForUi.title).toBe('Validate Skill: @demo')
    expect(result.resultForUi.summary).toBe('1 skill(s), 0 issue(s)')
    await expect(tool.execute({ name: '@missing' }, executionContext)).rejects.toThrow(
      'Skill "@missing" not found.'
    )
  })
})
