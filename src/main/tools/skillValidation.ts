import { Skill } from '../../shared/types'

export function validateSkillRecord(skill: Skill, allSkills: Skill[]): string[] {
  const issues: string[] = []
  if (!skill.name.trim()) issues.push('Missing skill name.')
  if (!skill.trigger.trim()) issues.push('Missing primary trigger.')
  if (!skill.rawMarkdown && !skill.prompt.trim()) issues.push('Missing SKILL.md instructions.')
  if (!skill.description && !skill.interface?.shortDescription) {
    issues.push('Missing description or interface.shortDescription for discovery.')
  }
  const duplicateTriggers = allSkills
    .filter((other) => other.id !== skill.id)
    .flatMap((other) => other.triggers || [other.trigger])
    .filter((trigger) => (skill.triggers || [skill.trigger]).includes(trigger))
  if (duplicateTriggers.length > 0) {
    issues.push(`Duplicate trigger(s): ${Array.from(new Set(duplicateTriggers)).join(', ')}`)
  }
  if ((skill.rawMarkdown || skill.prompt).length > 30000) {
    issues.push('SKILL.md is very long; move detailed material into references/.')
  }
  return issues
}
