import { Skill, SkillInterfaceMetadata, SkillPackageFile, ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { pathEscapesWorkspace } from '../agent/commandSafety'
import { getSkillRoot } from '../paths'
import { loadSkillsFromFolders } from '../skillManager'
import { parseSkillMarkdown } from '../../shared/skillParser'
import { getWorkspaceRoot, isPathInWorkspace, isSensitiveFile } from './helpers'
import { ToolDefinition, ToolExecutionContext } from './types'
import { createSkillResult } from './skillResult'
import { createSkillListResult } from './skillListResult'
import { getSkillDisplayName } from './skillMetadata'
import { formatSkillForModel } from './skillModelFormat'
import { normalizeSkillResourcePath } from './skillResourcePath'
import { cleanSkillLookup, resolveSkill } from './skillLookup'
import { validateSkillRecord } from './skillValidation'
import { promises as fs } from 'fs'
import { basename, join, resolve } from 'path'

function resolveSkillResource(skill: Skill, path: string): SkillPackageFile | undefined {
  const normalized = normalizeSkillResourcePath(path).toLowerCase()
  const files = skill.packageFiles || []
  return files.find((file) => normalizeSkillResourcePath(file.path).toLowerCase() === normalized)
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}

function serializeQuickAiInterface(metadata: SkillInterfaceMetadata): string {
  const lines = ['interface:']
  if (metadata.displayName) lines.push(`  display_name: ${quoteYamlString(metadata.displayName)}`)
  if (metadata.shortDescription) {
    lines.push(`  short_description: ${quoteYamlString(metadata.shortDescription)}`)
  }
  if (metadata.iconSmall) lines.push(`  icon_small: ${quoteYamlString(metadata.iconSmall)}`)
  if (metadata.iconLarge) lines.push(`  icon_large: ${quoteYamlString(metadata.iconLarge)}`)
  if (metadata.defaultPrompt) {
    lines.push(`  default_prompt: ${quoteYamlString(metadata.defaultPrompt)}`)
  }
  return `${lines.join('\n')}\n`
}

function buildSkillMarkdown(args: {
  name: string
  trigger?: string
  description?: string
  instructions: string
  kind?: string
}): string {
  const frontmatter = [
    `name: ${quoteYamlString(args.name)}`,
    args.trigger ? `trigger: ${quoteYamlString(cleanSkillLookup(args.trigger))}` : '',
    args.description ? `description: ${quoteYamlString(args.description)}` : '',
    args.kind === 'prompt' ? 'kind: prompt' : 'kind: agent'
  ].filter(Boolean)

  const body = args.instructions.trimStart().startsWith('# ')
    ? args.instructions.trim()
    : `# ${args.name}\n\n${args.instructions.trim()}`

  return `---\n${frontmatter.join('\n')}\n---\n\n${body}\n`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

function normalizeComparablePath(path: string): string {
  const normalized = resolve(path).replace(/\\/g, '/')
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function sameFilesystemPath(a: string, b: string): boolean {
  return normalizeComparablePath(a) === normalizeComparablePath(b)
}

function getSkillStoragePath(skill: Skill): string | undefined {
  if (skill.source === 'markdown' && skill.filePath) return skill.filePath
  return skill.dirPath || skill.filePath
}

function assertNoConflictingInstalledSkill(
  skill: Skill,
  destinationDir: string,
  overwrite: boolean
): void {
  const existing = loadSkillsFromFolders().find((candidate) => candidate.id === skill.id)
  if (!existing) return

  const existingPath = getSkillStoragePath(existing)
  if (existingPath && sameFilesystemPath(existingPath, destinationDir)) {
    if (!overwrite) {
      throw new Error(`Skill already installed at ${existingPath}`)
    }
    return
  }

  const location = existingPath || 'another installed location'
  throw new Error(
    `Skill ID "${skill.id}" already exists at ${location}. Remove it before creating another skill with the same trigger.`
  )
}

function assertSafeSkillRemovalTarget(targetPath: string): void {
  const target = normalizeComparablePath(targetPath)
  const skillRoot = normalizeComparablePath(getSkillRoot())
  const systemRoot = normalizeComparablePath(join(getSkillRoot(), '.system'))
  if (target === skillRoot || target === systemRoot) {
    throw new Error('Refusing to remove the skill root directory.')
  }
}

async function resolveReadableLocalPath(
  inputPath: string,
  ctx: ToolExecutionContext
): Promise<string> {
  const root = getWorkspaceRoot()
  const resolvedPath = resolve(root, inputPath)
  let realPath: string
  try {
    realPath = await fs.realpath(resolvedPath)
  } catch {
    throw new Error(`Path does not exist: ${inputPath}`)
  }

  const inputEscapes = pathEscapesWorkspace(inputPath)
  const hasRunCtx = !!(ctx.reqId && getRun(ctx.reqId))
  if (!isPathInWorkspace(realPath) && (!inputEscapes || !hasRunCtx)) {
    throw new Error('Security Violation: Path is outside the workspace directory.')
  }
  if (isSensitiveFile(realPath)) {
    throw new Error('Security Violation: Sensitive file paths cannot be installed as skills.')
  }
  return realPath
}

async function copySkillDirectory(sourceDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  await fs.mkdir(destDir, { recursive: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const source = join(sourceDir, entry.name)
    const destination = join(destDir, entry.name)
    if (entry.isDirectory()) {
      await copySkillDirectory(source, destination)
    } else if (entry.isFile()) {
      await fs.copyFile(source, destination)
    }
  }
}

function isSystemSkill(skill: Skill): boolean {
  const targetPath = getSkillStoragePath(skill)
  return Boolean(targetPath && normalizeComparablePath(targetPath).includes('/.system/'))
}

export const skillTools: Record<string, ToolDefinition> = {
  create_skill: {
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
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
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

      assertNoConflictingInstalledSkill(skill, skillDir, overwrite)
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
  },
  install_skill: {
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

      assertNoConflictingInstalledSkill(skill, destinationDir, overwrite)
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
  },
  remove_skill: {
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
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!name) throw new Error('Missing or invalid name parameter')

      const skills = loadSkillsFromFolders()
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
  },
  validate_skill: {
    name: 'validate_skill',
    title: 'Validate Skill',
    description:
      'Validates one installed QuickAI skill, or all installed skills when name is omitted. Checks discovery metadata, duplicate triggers, SKILL.md size, and package basics.',
    tags: ['skills', 'validate', 'lint', 'check', 'skill'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional skill name, trigger, @mention, or ID. Omit to validate all skills.'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const skills = loadSkillsFromFolders()
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const targets = name ? [resolveSkill(skills, name)].filter((s): s is Skill => !!s) : skills
      if (name && targets.length === 0) {
        throw new Error(`Skill "${name}" not found.`)
      }

      const lines = ['Skill Validation:']
      let issueCount = 0
      for (const skill of targets) {
        const issues = validateSkillRecord(skill, skills)
        lines.push(`- ${skill.id} (@${skill.trigger}): ${issues.length === 0 ? 'OK' : 'Issues'}`)
        if (skill.filePath) lines.push(`  File: ${skill.filePath}`)
        for (const issue of issues) {
          issueCount += 1
          lines.push(`  - ${issue}`)
        }
      }

      return createSkillResult({
        resultForModel: lines.join('\n'),
        title: name ? `Validate Skill: ${name}` : 'Validate Skills',
        summary: `${targets.length} skill(s), ${issueCount} issue(s)`
      })
    }
  },
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
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!name) {
        throw new Error('Missing or invalid name parameter')
      }

      const skills = loadSkillsFromFolders()
      const skill = resolveSkill(skills, name)
      if (!skill) {
        const available = skills
          .map((s) => {
            const triggers = s.triggers && s.triggers.length > 0 ? s.triggers : [s.trigger]
            return `${getSkillDisplayName(s)} (${triggers.map((t) => `@${t}`).join(', ')})`
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
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const path = typeof args.path === 'string' ? normalizeSkillResourcePath(args.path) : ''
      if (!name) throw new Error('Missing or invalid name parameter')
      if (!path) throw new Error('Missing or invalid path parameter')

      const skills = loadSkillsFromFolders()
      const skill = resolveSkill(skills, name)
      if (!skill) {
        throw new Error(`Skill "${name}" not found. Call list_skills to inspect installed skills.`)
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
          nextOffset !== undefined ? `\nMore available: call again with offset=${nextOffset}.` : ''
        }\n\nContent:\n${slice}`,
        title: `Skill Resource: ${resource.path}`,
        summary: `${skill.id} chars ${offset}-${endOffset}`
      })
    }
  },
  list_skills: {
    name: 'list_skills',
    title: 'List Installed Skills',
    description:
      'Lists all custom Skills currently installed in QuickAI. Call without parameters to list summaries, or pass a skillId to retrieve its full prompt instructions and auxiliary files list.',
    tags: ['skills', 'list', 'available', 'triggers', 'commands', '列表', '技能', '快捷指令'],
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
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const skills = loadSkillsFromFolders()

      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : undefined
      if (skillId) {
        const s = resolveSkill(skills, skillId)
        if (!s) {
          throw new Error(
            `Skill "${skillId}" not found. Call list_skills without parameters to list all installed skills.`
          )
        }

        return createSkillResult({
          resultForModel: formatSkillForModel(s, false),
          title: `Skill Details: ${getSkillDisplayName(s)}`,
          summary: `Loaded details for skill ${s.id}`
        })
      }

      return createSkillListResult(skills)
    }
  }
}
