import { useEffect, useState } from 'react'
import { Skill } from '../../../shared/types'
import { parseSkillMarkdown } from '../utils/skillMarkdown'

export interface UseSkillsReturn {
  skills: Skill[]
  installSkillFromMarkdown: (fileName: string, markdown: string) => Promise<Skill>
  removeSkill: (id: string) => Promise<void>
}

const normalizeLoadedSkill = (skill: Skill): Skill => {
  const triggers = skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
  const kind = skill.kind || (skill.mode === 'run' ? 'agent' : 'prompt')
  const tools =
    kind === 'agent'
      ? Array.from(new Set([...(skill.tools || []), 'fetch_url']))
      : skill.tools || []
  return {
    ...skill,
    trigger: skill.trigger || triggers[0],
    triggers,
    kind,
    tools,
    mode: skill.mode || (kind === 'agent' ? 'run' : 'insert'),
    rawMarkdown: skill.rawMarkdown || skill.prompt
  }
}

const sortSkills = (skills: Skill[]): Skill[] => {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name))
}

export const useSkills = (): UseSkillsReturn => {
  const [skills, setSkills] = useState<Skill[]>([])

  useEffect(() => {
    const loadSkills = async (): Promise<void> => {
      const savedSkills = ((await window.api.storeGet('skills')) as Skill[]) || []
      setSkills(sortSkills(savedSkills.map(normalizeLoadedSkill)))
    }

    loadSkills().catch(console.error)
  }, [])

  const persistSkills = async (nextSkills: Skill[]): Promise<void> => {
    const sorted = sortSkills(nextSkills.map(normalizeLoadedSkill))
    setSkills(sorted)
    await window.api.storeSet('skills', sorted)
  }

  const installSkillFromMarkdown = async (fileName: string, markdown: string): Promise<Skill> => {
    const parsedSkill = parseSkillMarkdown(markdown, fileName)
    const now = Date.now()
    const existingSkill = skills.find((skill) => skill.id === parsedSkill.id)
    const installedSkill: Skill = {
      ...parsedSkill,
      installedAt: existingSkill?.installedAt || now,
      updatedAt: now
    }
    const nextSkills = [...skills.filter((skill) => skill.id !== installedSkill.id), installedSkill]

    await persistSkills(nextSkills)
    return installedSkill
  }

  const removeSkill = async (id: string): Promise<void> => {
    await persistSkills(skills.filter((skill) => skill.id !== id))
  }

  return {
    skills,
    installSkillFromMarkdown,
    removeSkill
  }
}
