import { Skill } from '../../shared/types'

export function cleanSkillLookup(value: string): string {
  return value
    .trim()
    .replace(/^[@/]+/, '')
    .toLowerCase()
}

export function getSkillLookupKeys(skill: Skill): string[] {
  const keys = new Set<string>()
  const add = (value: string | undefined): void => {
    if (!value) return
    const clean = cleanSkillLookup(value)
    if (clean) keys.add(clean)
  }

  add(skill.id)
  add(skill.id.replace(/^skill-/, ''))
  add(skill.name)
  add(skill.trigger)
  ;(skill.triggers || []).forEach(add)

  return Array.from(keys)
}

export function resolveSkill(skills: Skill[], lookup: string): Skill | undefined {
  const clean = cleanSkillLookup(lookup)
  if (!clean) return undefined
  return skills.find((skill) => getSkillLookupKeys(skill).includes(clean))
}
