import { ToolArgs } from '../../shared/types'
import { getSkillDisplayName } from './skillMetadata'
import { resolveSkill } from './skillLookup'
import { createSkillResult } from './skillResult'
import { ToolDefinition } from './types'
import {
  assertSafeSkillRemovalTarget,
  CreateSkillLifecycleToolsOptions,
  getSkillStoragePath,
  isSystemSkill
} from './skillLifecycleShared'
import { promises as fs } from 'fs'

export function createRemoveSkillTool(options: CreateSkillLifecycleToolsOptions): ToolDefinition {
  return {
    name: 'remove_skill',
    title: 'Remove Skill',
    description:
      'Removes an installed QuickAI skill folder. System skills are protected unless allowSystem=true.',
    tags: ['skills', 'remove', 'delete', 'uninstall', 'skill'],
    category: 'system',
    risk: 'high',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, trigger, @mention, or ID.' },
        allowSystem: {
          type: 'boolean',
          description: 'Allow removing a .system skill. Defaults to false.'
        }
      },
      required: ['name']
    },
    execute: async (args: ToolArgs) => {
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!name) throw new Error('Missing or invalid name parameter')

      const skills = options.loadSkills()
      const skill = resolveSkill(skills, name)
      if (!skill) {
        throw new Error(`Skill "${name}" not found.`)
      }
      const targetPath = getSkillStoragePath(skill)
      if (!targetPath) {
        throw new Error(`Skill "${name}" has no removable file or folder.`)
      }
      if (isSystemSkill(skill) && args.allowSystem !== true) {
        throw new Error('Refusing to remove a system skill without allowSystem=true.')
      }
      assertSafeSkillRemovalTarget(targetPath)

      const targetStats = await fs.stat(targetPath)
      await fs.rm(targetPath, { recursive: targetStats.isDirectory(), force: false })

      return createSkillResult({
        resultForModel: `Removed QuickAI skill:\nID: ${skill.id}\nPath: ${targetPath}`,
        title: `Remove Skill: ${getSkillDisplayName(skill)}`,
        summary: `Removed ${skill.id}`
      })
    }
  }
}
