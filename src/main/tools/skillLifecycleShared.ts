import { Skill, SkillInterfaceMetadata } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { normalizeComparablePath, pathEscapesWorkspace } from '../agent/pathPolicy'
import { getSkillRoot } from '../paths'
import { cleanSkillLookup } from './skillLookup'
import { getWorkspaceRoot, isPathInWorkspace, isSensitiveFile } from './helpers'
import { ToolExecutionContext } from './types'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'

export interface CreateSkillLifecycleToolsOptions {
  loadSkills: () => Skill[]
}

export function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}

export function serializeQuickAiInterface(metadata: SkillInterfaceMetadata): string {
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

export function buildSkillMarkdown(args: {
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

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

export function sameFilesystemPath(a: string, b: string): boolean {
  return normalizeComparablePath(a) === normalizeComparablePath(b)
}

export function getSkillStoragePath(skill: Skill): string | undefined {
  if (skill.source === 'markdown' && skill.filePath) return skill.filePath
  return skill.dirPath || skill.filePath
}

export function assertNoConflictingInstalledSkill(
  skill: Skill,
  destinationDir: string,
  overwrite: boolean,
  loadSkills: () => Skill[]
): void {
  const existing = loadSkills().find((candidate) => candidate.id === skill.id)
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

export function assertSafeSkillRemovalTarget(targetPath: string): void {
  const target = normalizeComparablePath(targetPath)
  const skillRoot = normalizeComparablePath(getSkillRoot())
  const systemRoot = normalizeComparablePath(join(getSkillRoot(), '.system'))
  if (target === skillRoot || target === systemRoot) {
    throw new Error('Refusing to remove the skill root directory.')
  }
}

export async function resolveReadableLocalPath(
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

export async function copySkillDirectory(sourceDir: string, destDir: string): Promise<void> {
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

export function isSystemSkill(skill: Skill): boolean {
  const targetPath = getSkillStoragePath(skill)
  return Boolean(targetPath && normalizeComparablePath(targetPath).includes('/.system/'))
}
