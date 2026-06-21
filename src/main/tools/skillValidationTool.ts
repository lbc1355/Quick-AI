import { Skill, ToolArgs } from '../../shared/types'
import { ToolDefinition } from './types'
import { createSkillResult } from './skillResult'
import { resolveSkill } from './skillLookup'
import { validateSkillRecord } from './skillValidation'

interface CreateValidateSkillToolOptions {
  loadSkills: () => Skill[]
}

export function createValidateSkillTool(options: CreateValidateSkillToolOptions): ToolDefinition {
  return {
    name: 'validate_skill',
    title: 'Validate Skill',
    description:
      'Validates one installed QuickAI skill, or all installed skills when name is omitted. Checks discovery metadata, duplicate triggers, SKILL.md size, and package basics.',
    tags: ['skills', 'validate', 'lint', 'check', 'skill'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional skill name, trigger, @mention, or ID. Omit to validate all skills.'
        }
      }
    },
    execute: async (args: ToolArgs) => {
      const skills = options.loadSkills()
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const targets = name ? [resolveSkill(skills, name)].filter((s): s is Skill => !!s) : skills
      if (name && targets.length === 0) {
        throw new Error(`Skill "${name}" not found.`)
      }

      const lines = ['Skill Validation:']
      let issueCount = 0
      for (const skill of targets) {
        const issues = validateSkillRecord(skill, skills)
        lines.push(`- ${skill.id} (@${skill.trigger}): ${issues.length === 0 ? 'OK' : 'Issues'}`)
        if (skill.filePath) lines.push(`  File: ${skill.filePath}`)
        for (const issue of issues) {
          issueCount += 1
          lines.push(`  - ${issue}`)
        }
      }

      return createSkillResult({
        resultForModel: lines.join('\n'),
        title: name ? `Validate Skill: ${name}` : 'Validate Skills',
        summary: `${targets.length} skill(s), ${issueCount} issue(s)`
      })
    }
  }
}
