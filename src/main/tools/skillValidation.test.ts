import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { resolveSkill } from './skillLookup'
import { validateSkillRecord } from './skillValidation'

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-demo',
  name: 'Demo Skill',
  trigger: 'demo',
  prompt: 'Run demo workflow.',
  description: 'Use demo workflow.',
  ...overrides
})

describe('skill lookup and validation helpers', () => {
  it('resolves skills by trigger, id, id without prefix, and display name', () => {
    const skill = makeSkill({
      id: 'skill-paper-reader',
      name: 'Paper Reader',
      trigger: 'paper',
      triggers: ['paper', 'read-paper']
    })

    expect(resolveSkill([skill], '@paper')).toBe(skill)
    expect(resolveSkill([skill], 'skill-paper-reader')).toBe(skill)
    expect(resolveSkill([skill], 'paper-reader')).toBe(skill)
    expect(resolveSkill([skill], 'read-paper')).toBe(skill)
    expect(resolveSkill([skill], 'Paper Reader')).toBe(skill)
  })

  it('reports missing metadata and duplicate triggers', () => {
    const target = makeSkill({
      id: 'skill-target',
      name: '',
      trigger: 'shared',
      prompt: '',
      description: ''
    })
    const duplicate = makeSkill({
      id: 'skill-duplicate',
      trigger: 'shared'
    })

    expect(validateSkillRecord(target, [target, duplicate])).toEqual([
      'Missing skill name.',
      'Missing SKILL.md instructions.',
      'Missing description or interface.shortDescription for discovery.',
      'Duplicate trigger(s): shared'
    ])
  })
})
