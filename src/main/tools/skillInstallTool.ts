import { ToolArgs } from '../../shared/types'
import { parseSkillMarkdown } from '../../shared/skillParser'
import { getSkillRoot } from '../paths'
import { createSkillResult } from './skillResult'
import { ToolDefinition, ToolExecutionContext } from './types'
import {
  assertNoConflictingInstalledSkill,
  copySkillDirectory,
  CreateSkillLifecycleToolsOptions,
  pathExists,
  resolveReadableLocalPath,
  sameFilesystemPath
} from './skillLifecycleShared'
import { promises as fs } from 'fs'
import { basename, join } from 'path'

export function createInstallSkillTool(options: CreateSkillLifecycleToolsOptions): ToolDefinition {
  return {
    name: 'install_skill',
    title: 'Install Skill',
    description:
      'Installs a QuickAI skill from a local folder containing SKILL.md or from a single markdown file. Preserves folder resources and refuses to overwrite by default.',
    tags: ['skills', 'install', 'import', 'copy', 'skill'],
    category: 'system',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Source folder containing SKILL.md, or a single .md/.markdown skill file.'
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to replace an existing installed skill. Defaults to false.'
        }
      },
      required: ['path']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const sourceArg = typeof args.path === 'string' ? args.path.trim() : ''
      if (!sourceArg) throw new Error('Missing or invalid path parameter')

      const sourcePath = await resolveReadableLocalPath(sourceArg, ctx)
      const sourceStats = await fs.stat(sourcePath)
      const overwrite = args.overwrite === true
      let markdown = ''
      let sourceSkillDir: string | undefined

      if (sourceStats.isDirectory()) {
        const upper = join(sourcePath, 'SKILL.md')
        const lower = join(sourcePath, 'skill.md')
        if (await pathExists(upper)) {
          markdown = await fs.readFile(upper, 'utf-8')
        } else if (await pathExists(lower)) {
          markdown = await fs.readFile(lower, 'utf-8')
        } else {
          throw new Error('Source directory must contain SKILL.md or skill.md')
        }
        sourceSkillDir = sourcePath
      } else if (sourceStats.isFile() && /\.(md|markdown)$/i.test(sourcePath)) {
        markdown = await fs.readFile(sourcePath, 'utf-8')
      } else {
        throw new Error('Source path must be a skill folder or a .md/.markdown file.')
      }

      const skill = parseSkillMarkdown(markdown, basename(sourcePath), {
        source: sourceStats.isDirectory() ? 'folder' : 'markdown'
      })
      const destinationDir = join(getSkillRoot(), skill.id)
      const sourceIsDestination = sourceSkillDir
        ? sameFilesystemPath(sourceSkillDir, destinationDir)
        : false

      assertNoConflictingInstalledSkill(skill, destinationDir, overwrite, options.loadSkills)
      if ((await pathExists(destinationDir)) && !overwrite) {
        throw new Error(`Skill already installed at ${destinationDir}`)
      }
      if (sourceIsDestination) {
        return createSkillResult({
          resultForModel: `Skill is already installed:\nID: ${skill.id}\nName: ${skill.name}\nTrigger: @${skill.trigger}\nDirectory: ${destinationDir}`,
          title: `Install Skill: ${skill.name}`,
          filePath: destinationDir,
          summary: `Already installed ${skill.id} (@${skill.trigger})`
        })
      }
      if (overwrite) {
        await fs.rm(destinationDir, { recursive: true, force: true })
      }

      if (sourceSkillDir) {
        await copySkillDirectory(sourceSkillDir, destinationDir)
      } else {
        await fs.mkdir(destinationDir, { recursive: true })
        await fs.writeFile(join(destinationDir, 'SKILL.md'), markdown, 'utf-8')
      }

      return createSkillResult({
        resultForModel: `Installed QuickAI skill:\nID: ${skill.id}\nName: ${skill.name}\nTrigger: @${skill.trigger}\nDirectory: ${destinationDir}\nNext: call list_skills to confirm the live catalog.`,
        title: `Install Skill: ${skill.name}`,
        filePath: destinationDir,
        summary: `Installed ${skill.id} (@${skill.trigger})`
      })
    }
  }
}
