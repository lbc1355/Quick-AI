import { useCallback, useEffect, useState } from 'react'
import { Skill, SkillInstallPayload, SkillPackageFile } from '../../../shared/types'
import { parseSkillMarkdown } from '../utils/skillMarkdown'

export interface UseSkillsReturn {
  skills: Skill[]
  installSkill: (payload: SkillInstallPayload) => Promise<Skill>
  removeSkill: (id: string) => Promise<void>
}

const normalizePackageFiles = (
  files: SkillPackageFile[] | undefined
): SkillPackageFile[] | undefined => {
  if (!files || files.length === 0) return undefined

  const unique = new Map<string, SkillPackageFile>()
  files.forEach((file) => {
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (!normalizedPath || typeof file.content !== 'string') return
    unique.set(normalizedPath, {
      path: normalizedPath,
      content: file.content,
      size: file.size || file.content.length
    })
  })

  const normalized = Array.from(unique.values()).sort((a, b) => a.path.localeCompare(b.path))
  return normalized.length > 0 ? normalized : undefined
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
    rawMarkdown: skill.rawMarkdown || skill.prompt,
    packageFiles: normalizePackageFiles(skill.packageFiles)
  }
}

const sortSkills = (skills: Skill[]): Skill[] => {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name))
}

export const useSkills = (): UseSkillsReturn => {
  const [skills, setSkills] = useState<Skill[]>([])

  const applyLoadedSkills = useCallback((loadedSkills: Skill[]): void => {
    setSkills(sortSkills(loadedSkills.map(normalizeLoadedSkill)))
  }, [])

  useEffect(() => {
    let active = true

    const loadSkills = async (): Promise<void> => {
      const savedSkills = ((await window.api.storeGet('skills')) as Skill[]) || []
      if (active) {
        applyLoadedSkills(savedSkills)
      }
    }

    loadSkills().catch(console.error)
    const unsubscribe = window.api.onSkillsUpdated((nextSkills) => {
      if (active) {
        applyLoadedSkills(nextSkills || [])
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [applyLoadedSkills])

  const persistSkills = async (nextSkills: Skill[]): Promise<void> => {
    const sorted = sortSkills(nextSkills.map(normalizeLoadedSkill))
    setSkills(sorted)
    await window.api.storeSet('skills', sorted)
  }

  const installSkill = async (payload: SkillInstallPayload): Promise<Skill> => {
    const packageFiles = normalizePackageFiles(payload.packageFiles)
    const parsedSkill = parseSkillMarkdown(payload.markdown, payload.fileName, {
      source: payload.source,
      entryPath: payload.entryPath,
      packageRoot: payload.packageRoot,
      packageFiles
    })
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
    installSkill,
    removeSkill
  }
}
