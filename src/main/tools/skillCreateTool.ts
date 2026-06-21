import { SkillInterfaceMetadata, ToolArgs } from '../../shared/types'
import { parseSkillMarkdown } from '../../shared/skillParser'
import { getSkillRoot } from '../paths'
import { cleanSkillLookup } from './skillLookup'
import { createSkillResult } from './skillResult'
import { ToolDefinition } from './types'
import {
  assertNoConflictingInstalledSkill,
  buildSkillMarkdown,
  CreateSkillLifecycleToolsOptions,
  pathExists,
  serializeQuickAiInterface
} from './skillLifecycleShared'
import { promises as fs } from 'fs'
import { join } from 'path'

export function createCreateSkillTool(options: CreateSkillLifecycleToolsOptions): ToolDefinition {
  return {
    name: 'create_skill',
    title: 'Create Skill',
    description:
      'Creates a new QuickAI folder-style skill under the global skill root. Use for new reusable workflows; refuses to overwrite an existing skill unless overwrite=true.',
    tags: ['skills', 'create', 'scaffold', 'skill', 'workflow'],
    category: 'system',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable skill name.' },
        trigger: {
          type: 'string',
          description: 'Optional @trigger. Defaults to a slug derived from the name.'
        },
        description: {
          type: 'string',
          description: 'Discovery description: when to use this skill and when not to use it.'
        },
        instructions: {
          type: 'string',
          description: 'Initial SKILL.md body instructions.'
        },
        kind: {
          type: 'string',
          enum: ['agent', 'prompt'],
          description: 'Skill kind. Defaults to agent.'
        },
        displayName: {
          type: 'string',
          description: 'Optional agents/quickai.yaml display_name.'
        },
        shortDescription: {
          type: 'string',
          description: 'Optional agents/quickai.yaml short_description.'
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to replace an existing skill directory. Defaults to false.'
        }
      },
      required: ['name', 'instructions']
    },
    execute: async (args: ToolArgs) => {
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : ''
      if (!name) throw new Error('Missing or invalid name parameter')
      if (!instructions) throw new Error('Missing or invalid instructions parameter')

      const markdown = buildSkillMarkdown({
        name,
        trigger: typeof args.trigger === 'string' ? args.trigger : undefined,
        description: typeof args.description === 'string' ? args.description.trim() : undefined,
        instructions,
        kind: args.kind === 'prompt' ? 'prompt' : 'agent'
      })
      const quickAiInterface: SkillInterfaceMetadata = {
        displayName: typeof args.displayName === 'string' ? args.displayName.trim() : undefined,
        shortDescription:
          typeof args.shortDescription === 'string' ? args.shortDescription.trim() : undefined,
        defaultPrompt:
          typeof args.trigger === 'string'
            ? `Use @${cleanSkillLookup(args.trigger)} for this workflow.`
            : undefined
      }
      const skill = parseSkillMarkdown(markdown, `${name}.md`, {
        source: 'folder',
        entryPath: 'SKILL.md',
        packageRoot: ''
      })
      const skillDir = join(getSkillRoot(), skill.id)
      const overwrite = args.overwrite === true

      assertNoConflictingInstalledSkill(skill, skillDir, overwrite, options.loadSkills)
      if ((await pathExists(skillDir)) && !overwrite) {
        throw new Error(`Skill directory already exists: ${skillDir}`)
      }
      if (overwrite) {
        await fs.rm(skillDir, { recursive: true, force: true })
      }

      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(join(skillDir, 'SKILL.md'), markdown, 'utf-8')
      if (Object.values(quickAiInterface).some(Boolean)) {
        await fs.mkdir(join(skillDir, 'agents'), { recursive: true })
        await fs.writeFile(
          join(skillDir, 'agents', 'quickai.yaml'),
          serializeQuickAiInterface(quickAiInterface),
          'utf-8'
        )
      }

      return createSkillResult({
        resultForModel: `Created QuickAI skill:\nID: ${skill.id}\nTrigger: @${skill.trigger}\nDirectory: ${skillDir}\nNext: call load_skill with "${skill.trigger}" or validate_skill with "${skill.id}".`,
        title: `Create Skill: ${skill.name}`,
        filePath: skillDir,
        summary: `Created ${skill.id} (@${skill.trigger})`
      })
    }
  }
}
