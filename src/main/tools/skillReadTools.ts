import { Skill, SkillPackageFile, ToolArgs } from '../../shared/types'
import { ToolDefinition } from './types'
import { createSkillResult } from './skillResult'
import { resolveSkill } from './skillLookup'
import { getSkillDisplayName, getSkillTriggers } from './skillMetadata'
import { formatSkillForModel } from './skillModelFormat'
import { normalizeSkillResourcePath } from './skillResourcePath'

interface CreateSkillReadToolsOptions {
  loadSkills: () => Skill[]
}

function resolveSkillResource(skill: Skill, path: string): SkillPackageFile | undefined {
  const normalized = normalizeSkillResourcePath(path).toLowerCase()
  const files = skill.packageFiles || []
  return files.find((file) => normalizeSkillResourcePath(file.path).toLowerCase() === normalized)
}

export function createSkillReadTools(
  options: CreateSkillReadToolsOptions
): Record<'load_skill' | 'read_skill_resource', ToolDefinition> {
  return {
    load_skill: {
      name: 'load_skill',
      title: 'Load Skill',
      description:
        'Loads SKILL.md instructions and an auxiliary file list for an installed QuickAI Skill. Use this when the user mentions @skill, names a skill, or the task matches a skill in the system prompt skill catalog. Use read_skill_resource to load listed auxiliary files only when needed.',
      tags: ['skills', 'load', 'invoke', 'manual', 'instructions', 'skill'],
      category: 'system',
      risk: 'low',
      implemented: true,
      discoverable: true,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Skill name, trigger, @mention, or ID. Examples: "@paper-reader", "paper-reader", "skill-paper-reader".'
          }
        },
        required: ['name']
      },
      execute: async (args: ToolArgs) => {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (!name) {
          throw new Error('Missing or invalid name parameter')
        }

        const skills = options.loadSkills()
        const skill = resolveSkill(skills, name)
        if (!skill) {
          const available = skills
            .map((candidate) => {
              const triggers = getSkillTriggers(candidate)
              return `${getSkillDisplayName(candidate)} (${triggers.map((t) => `@${t}`).join(', ')})`
            })
            .join(', ')
          throw new Error(
            available
              ? `Skill "${name}" not found. Available skills: ${available}`
              : `Skill "${name}" not found. No custom skills are installed.`
          )
        }

        return createSkillResult({
          resultForModel: `Loaded QuickAI Skill. Follow these instructions for the current user request. Auxiliary package files are listed but not loaded; call read_skill_resource for a listed Path when needed.\n\n${formatSkillForModel(skill, false)}`,
          title: `Load Skill: ${getSkillDisplayName(skill)}`,
          summary: `Loaded ${skill.id}`
        })
      }
    },
    read_skill_resource: {
      name: 'read_skill_resource',
      title: 'Read Skill Resource',
      description:
        'Reads a specific auxiliary file from an installed QuickAI Skill package. Use after load_skill or list_skills shows a resource Path that is relevant to the current task.',
      tags: ['skills', 'resource', 'reference', 'script', 'read', 'skill'],
      category: 'system',
      risk: 'low',
      implemented: true,
      discoverable: true,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Skill name, trigger, @mention, or ID.'
          },
          path: {
            type: 'string',
            description:
              'Auxiliary file path exactly as listed by load_skill/list_skills, such as references/api.md or scripts/helper.py.'
          },
          offset: {
            type: 'number',
            description: 'Optional character offset for paging through long files. Defaults to 0.'
          },
          maxChars: {
            type: 'number',
            description:
              'Optional max characters to return in this window (1000-16000). Defaults to 8000.'
          }
        },
        required: ['name', 'path']
      },
      execute: async (args: ToolArgs) => {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        const path = typeof args.path === 'string' ? normalizeSkillResourcePath(args.path) : ''
        if (!name) throw new Error('Missing or invalid name parameter')
        if (!path) throw new Error('Missing or invalid path parameter')

        const skills = options.loadSkills()
        const skill = resolveSkill(skills, name)
        if (!skill) {
          throw new Error(
            `Skill "${name}" not found. Call list_skills to inspect installed skills.`
          )
        }

        const resource = resolveSkillResource(skill, path)
        if (!resource || !resource.content.trim()) {
          const available = (skill.packageFiles || [])
            .filter(
              (file) => !normalizeSkillResourcePath(file.path).toLowerCase().startsWith('agents/')
            )
            .map((file) => file.path)
            .sort()
            .join(', ')
          throw new Error(
            available
              ? `Resource "${path}" not found in ${skill.id}. Available resources: ${available}`
              : `Resource "${path}" not found in ${skill.id}. This skill has no auxiliary resources.`
          )
        }

        const full = resource.content
        const rawOffset =
          typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0
        const offset = Math.max(0, Math.min(Math.floor(rawOffset), full.length))
        const rawMax =
          typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) ? args.maxChars : 8000
        const maxChars = Math.min(16000, Math.max(1000, Math.floor(rawMax)))
        const slice = full.slice(offset, offset + maxChars)
        const endOffset = offset + slice.length
        const nextOffset = endOffset < full.length ? endOffset : undefined

        return createSkillResult({
          resultForModel: `Skill Resource: ${skill.id}\nPath: ${resource.path}\nChars: ${offset}-${endOffset} of ${full.length}${
            nextOffset !== undefined
              ? `\nMore available: call again with offset=${nextOffset}.`
              : ''
          }\n\nContent:\n${slice}`,
          title: `Skill Resource: ${resource.path}`,
          summary: `${skill.id} chars ${offset}-${endOffset}`
        })
      }
    }
  }
}
