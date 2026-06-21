import { describe, expect, it } from 'vitest'
import { Skill } from '../../shared/types'
import { createSkillListResult } from './skillListResult'

describe('skill list result formatter', () => {
  it('builds model lines and UI items for installed skills', () => {
    const skills: Skill[] = [
      {
        id: 'skill-paper',
        name: 'Internal Paper Skill',
        trigger: 'paper',
        triggers: ['paper', 'read-paper'],
        prompt: 'Read the paper.',
        description: 'Use for paper reading.',
        interface: {
          displayName: 'Paper Reader',
          shortDescription: 'Read papers carefully'
        },
        mode: 'insert',
        kind: 'agent',
        tools: ['file_read'],
        source: 'folder',
        filePath: 'D:\\Git\\skills\\paper\\SKILL.md',
        dirPath: 'D:\\Git\\skills\\paper'
      }
    ]

    const result = createSkillListResult(skills)

    expect(result.resultForModel).toContain('Installed Skills:')
    expect(result.resultForModel).toContain('Name: Paper Reader')
    expect(result.resultForModel).toContain('Internal Name: Internal Paper Skill')
    expect(result.resultForModel).toContain('Declared Tools: file_read')
    expect(result.resultForUi.summary).toBe('Found 1 skills')
    expect(result.resultForUi.items?.[0]).toMatchObject({
      title: 'Paper Reader',
      url: 'file:///D:/Git/skills/paper/SKILL.md',
      source: 'folder'
    })
    expect(result.resultForUi.items?.[0].snippet).toContain('Triggers: paper, read-paper')
  })

  it('returns the empty installed skills message', () => {
    const result = createSkillListResult([])

    expect(result.resultForModel).toBe('No custom skills installed.')
    expect(result.resultForUi.summary).toBe('0 skills installed')
  })
})
