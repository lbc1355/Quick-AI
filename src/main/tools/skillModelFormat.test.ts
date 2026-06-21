import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { formatSkillForModel } from './skillModelFormat'

const baseSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-rich',
  name: 'Rich Skill',
  trigger: 'rich',
  triggers: ['rich', 'rich-alt'],
  prompt: 'Follow the rich workflow.',
  description: 'Use rich workflow.',
  source: 'folder',
  entryPath: 'SKILL.md',
  filePath: 'D:\\skills\\rich\\SKILL.md',
  dirPath: 'D:\\skills\\rich',
  packageFiles: [],
  ...overrides
})

describe('skill model formatter', () => {
  it('lists auxiliary package files without loading their content by default', () => {
    const result = formatSkillForModel(
      baseSkill({
        packageFiles: [
          { path: 'SKILL.md', content: 'entry content', size: 12 },
          { path: 'agents/quickai.yaml', content: 'hidden metadata', size: 15 },
          { path: 'references/notes.md', content: 'Reference details', size: 17 }
        ]
      }),
      false
    )

    expect(result).toContain('Skill ID: skill-rich')
    expect(result).toContain('Triggers: rich, rich-alt')
    expect(result).toContain('--- SKILL.md Prompt Instructions ---')
    expect(result).toContain('Follow the rich workflow.')
    expect(result).toContain('Packaged Auxiliary Files:')
    expect(result).toContain('- Path: references/notes.md (17 bytes)')
    expect(result).toContain('read_skill_resource')
    expect(result).not.toContain('Reference details')
    expect(result).not.toContain('agents/quickai.yaml')
  })

  it('includes package content when requested and truncates oversized files', () => {
    const result = formatSkillForModel(
      baseSkill({
        packageFiles: [
          {
            path: 'references/long.md',
            content: 'x'.repeat(7000),
            size: 7000
          }
        ]
      }),
      true
    )

    expect(result).toContain('--- Skill Package Files ---')
    expect(result).toContain('Path: references/long.md (7000 bytes)')
    expect(result).toContain('[File truncated for context size]')
    expect(result).not.toContain('read_skill_resource')
  })
})
