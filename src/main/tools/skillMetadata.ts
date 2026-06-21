import { Skill } from '../../shared/types'

export function getSkillDisplayName(skill: Skill): string {
  return skill.interface?.displayName || skill.name
}

export function getSkillShortDescription(skill: Skill): string {
  return skill.interface?.shortDescription || skill.description || ''
}

export function getSkillTriggers(skill: Skill): string[] {
  return skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
}
