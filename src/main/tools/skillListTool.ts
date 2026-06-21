import { Skill, ToolArgs } from '../../shared/types'
import { ToolDefinition } from './types'
import { createSkillListResult } from './skillListResult'
import { createSkillResult } from './skillResult'
import { resolveSkill } from './skillLookup'
import { getSkillDisplayName } from './skillMetadata'
import { formatSkillForModel } from './skillModelFormat'

interface CreateListSkillsToolOptions {
  loadSkills: () => Skill[]
}

export function createListSkillsTool(options: CreateListSkillsToolOptions): ToolDefinition {
  return {
    name: 'list_skills',
    title: 'List Installed Skills',
    description:
      'Lists all custom Skills currently installed in QuickAI. Call without parameters to list summaries, or pass a skillId to retrieve its full prompt instructions and auxiliary files list.',
    tags: ['skills', 'list', 'available', 'triggers', 'commands'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description:
            'Optional. The ID of a specific skill to retrieve its full prompt instructions and packaged files.'
        }
      }
    },
    execute: async (args: ToolArgs) => {
      const skills = options.loadSkills()

      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : undefined
      if (skillId) {
        const skill = resolveSkill(skills, skillId)
        if (!skill) {
          throw new Error(
            `Skill "${skillId}" not found. Call list_skills without parameters to list all installed skills.`
          )
        }

        return createSkillResult({
          resultForModel: formatSkillForModel(skill, false),
          title: `Skill Details: ${getSkillDisplayName(skill)}`,
          summary: `Loaded details for skill ${skill.id}`
        })
      }

      return createSkillListResult(skills)
    }
  }
}
