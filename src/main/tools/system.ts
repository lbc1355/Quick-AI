import {
  Skill,
  SkillInterfaceMetadata,
  SkillPackageFile,
  ToolArgs,
  TaskItem
} from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { showDesktopNotification } from './helpers'
import { cancelDesktopReminder, listPendingReminders, scheduleDesktopReminder } from './reminders'
import { probeEnvironment, formatEnvironmentReport, ProbeSection } from './environmentProbe'
import { readResourceChunkWindow } from '../resourceCache'
import { loadResourceCache } from '../database'
import { getRun } from '../agent/AgentRunContext'
import { loadSkillsFromFolders } from '../skillManager'
import { parseSkillMarkdown } from '../../shared/skillParser'
import { getSkillRoot } from '../paths'
import { promises as fs } from 'fs'
import { basename, join, resolve } from 'path'
import { pathEscapesWorkspace } from '../agent/commandSafety'
import { getWorkspaceRoot, isPathInWorkspace, isSensitiveFile } from './helpers'

const MAX_SKILL_PACKAGE_FILE_CHARS = 6000
const MAX_SKILL_PACKAGE_TOTAL_CHARS = 20000

function getSkillDisplayName(skill: Skill): string {
  return skill.interface?.displayName || skill.name
}

function getSkillShortDescription(skill: Skill): string {
  return skill.interface?.shortDescription || skill.description || ''
}

function cleanSkillLookup(value: string): string {
  return value
    .trim()
    .replace(/^[@/]+/, '')
    .toLowerCase()
}

function getSkillLookupKeys(skill: Skill): string[] {
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

function resolveSkill(skills: Skill[], lookup: string): Skill | undefined {
  const clean = cleanSkillLookup(lookup)
  if (!clean) return undefined
  return skills.find((skill) => getSkillLookupKeys(skill).includes(clean))
}

function normalizeSkillResourcePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

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

function validateSkillRecord(skill: Skill, allSkills: Skill[]): string[] {
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

function formatSkillPackageFiles(skill: Skill, includeContent: boolean): string[] {
  const files = (skill.packageFiles || [])
    .filter((file) => file.content.trim())
    .filter((file) => file.path.toLowerCase() !== (skill.entryPath || 'SKILL.md').toLowerCase())
    .filter((file) => !normalizeSkillResourcePath(file.path).toLowerCase().startsWith('agents/'))
    .sort((a, b) => a.path.localeCompare(b.path))

  if (files.length === 0) return []

  const lines = ['', includeContent ? '--- Skill Package Files ---' : 'Packaged Auxiliary Files:']
  let totalChars = 0

  for (const file of files) {
    if (!includeContent) {
      lines.push(`- Path: ${file.path} (${file.size} bytes)`)
      continue
    }

    if (totalChars >= MAX_SKILL_PACKAGE_TOTAL_CHARS) break
    const remaining = MAX_SKILL_PACKAGE_TOTAL_CHARS - totalChars
    const limit = Math.min(MAX_SKILL_PACKAGE_FILE_CHARS, remaining)
    const content =
      file.content.length > limit
        ? `${file.content.slice(0, Math.max(0, limit - 34))}\n[File truncated for context size]`
        : file.content

    lines.push(`Path: ${file.path} (${file.size} bytes)`)
    lines.push(content)
    lines.push('---')
    totalChars += content.length
  }

  return lines
}

function formatSkillForModel(skill: Skill, includePackageContent: boolean): string {
  const triggers = skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
  const shortDescription = getSkillShortDescription(skill)
  const packageLines = formatSkillPackageFiles(skill, includePackageContent)
  const lines = [
    `Skill ID: ${skill.id}`,
    `Name: ${getSkillDisplayName(skill)}`,
    getSkillDisplayName(skill) !== skill.name ? `Internal Name: ${skill.name}` : '',
    `Triggers: ${triggers.filter(Boolean).join(', ')}`,
    shortDescription ? `Description: ${shortDescription}` : '',
    skill.filePath ? `File Path: ${skill.filePath}` : '',
    skill.dirPath ? `Directory Path: ${skill.dirPath}` : '',
    `Mode: ${skill.mode || 'insert'}`,
    `Kind: ${skill.kind || 'prompt'}`,
    skill.tools && skill.tools.length > 0 ? `Declared Tools: ${skill.tools.join(', ')}` : '',
    '',
    '--- SKILL.md Prompt Instructions ---',
    skill.rawMarkdown || skill.prompt,
    '-------------------------------------',
    ...packageLines,
    ...(!includePackageContent && packageLines.length > 0
      ? [
          '',
          'Load auxiliary files only when needed with read_skill_resource using the listed Path.'
        ]
      : [])
  ]

  return lines.filter((line) => line !== '').join('\n')
}

const TASK_STATUSES: TaskItem['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const MAX_TASK_TITLE_LENGTH = 160

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTaskStatus(value: unknown, fallback: TaskItem['status']): TaskItem['status'] {
  return typeof value === 'string' && (TASK_STATUSES as string[]).includes(value)
    ? (value as TaskItem['status'])
    : fallback
}

function makeTaskId(title: string, index: number): string {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  return id || `task-${index + 1}`
}

function stripMarkdownJsonFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

function tryParseTaskJsonString(value: string): { jsonLike: boolean; parsed?: unknown } {
  const trimmed = stripMarkdownJsonFence(value)
  const jsonLike = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!jsonLike) return { jsonLike: false }
  try {
    return { jsonLike: true, parsed: JSON.parse(trimmed) }
  } catch {
    return { jsonLike: true }
  }
}

function isUnsafeTaskTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return true
  if (trimmed.length > MAX_TASK_TITLE_LENGTH) return true
  if (/[\r\n]/.test(trimmed)) return true
  if (/^```/.test(trimmed)) return true
  if (/^task\s*\(/i.test(trimmed)) return true
  if (/^[\[{]/.test(trimmed)) return true
  if (/"(?:tasks?|status|title|id)"\s*:/.test(trimmed)) return true
  return false
}

function pickTaskSource(args: unknown): unknown {
  if (Array.isArray(args) || typeof args === 'string') return args
  if (!isRecord(args)) return undefined
  if (args.tasks !== undefined) return args.tasks
  if (args.task !== undefined) return args.task
  if (args.items !== undefined) return args.items
  if (
    args.title !== undefined ||
    args.description !== undefined ||
    args.id !== undefined ||
    args.status !== undefined
  ) {
    return args
  }
  return undefined
}

function expandTaskSource(source: unknown): unknown[] {
  if (typeof source === 'string') {
    const parsed = tryParseTaskJsonString(source)
    if (parsed.jsonLike) {
      if (parsed.parsed === undefined) return []
      const parsedSource = pickTaskSource(parsed.parsed)
      return expandTaskSource(parsedSource ?? parsed.parsed)
    }
    return [source]
  }
  if (Array.isArray(source)) return source
  return source !== undefined ? [source] : []
}

function normalizeTaskEntry(
  item: unknown,
  index: number,
  fallbackStatus: TaskItem['status']
): TaskItem | undefined {
  if (typeof item === 'string') {
    const title = item.trim()
    if (isUnsafeTaskTitle(title)) return undefined
    return {
      id: makeTaskId(title, index),
      title,
      status: fallbackStatus
    }
  }

  if (!isRecord(item)) return undefined

  const titleValue = item.title ?? item.description ?? item.task ?? item.name ?? item.id
  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  if (isUnsafeTaskTitle(title)) return undefined

  const rawId = typeof item.id === 'string' ? item.id.trim() : ''
  return {
    id: rawId || makeTaskId(title, index),
    title,
    status: readTaskStatus(item.status, fallbackStatus)
  }
}

function normalizeTaskArgs(args: unknown): TaskItem[] {
  const source = pickTaskSource(args)
  const entries = expandTaskSource(source)
  const fallbackStatus = entries.length === 1 ? 'in_progress' : 'pending'
  return entries
    .map((item, index) => normalizeTaskEntry(item, index, fallbackStatus))
    .filter((item): item is TaskItem => Boolean(item))
}

function formatReminderDelay(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`

  const totalMinutes = Math.ceil(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (minutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`
}

function formatReminderLine(reminder: {
  id: string
  title: string
  message: string
  triggerAt: number
}): string {
  return `- ${reminder.id}: "${reminder.message}" at ${new Date(reminder.triggerAt).toISOString()} (title: "${reminder.title}", in ${formatReminderDelay(reminder.triggerAt - Date.now())})`
}

function getReminderClickHandler(ctx: ToolExecutionContext): (() => void) | undefined {
  const win = ctx.mainWindow
  if (!win) return undefined

  return () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function formatResourceRanges(ranges: Array<{ start: number; end: number }> | undefined): string {
  if (!ranges || ranges.length === 0) return ''
  return ranges
    .slice(0, 6)
    .map((range) => `${range.start}-${range.end}`)
    .join(', ')
}

function formatResourceOffsets(
  chunks: NonNullable<ToolExecutionContext['resources']>[number]['chunks']
): string {
  const offsets = chunks
    .map((chunk) =>
      chunk.offset !== undefined && chunk.endOffset !== undefined
        ? `${chunk.offset}-${chunk.endOffset}`
        : undefined
    )
    .filter((value): value is string => Boolean(value))

  if (offsets.length === 0) return ''
  const preview = offsets.slice(0, 8).join(', ')
  return offsets.length > 8 ? `${preview}, +${offsets.length - 8} more` : preview
}

export const systemTools: Record<string, ToolDefinition> = {
  list_cached_resources: {
    name: 'list_cached_resources',
    title: 'List Cached Resources',
    description:
      'Lists cached resources available in the current conversation, including resource IDs and cached offsets. Use this before read_cached_resource or search_cached_resource when you need prior fetched files, web pages, or documents.',
    tags: ['cache', 'resource', 'list', 'history', 'local', 'cached'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (_args: ToolArgs, ctx: ToolExecutionContext) => {
      const resources = [...(ctx.resources || [])].sort((a, b) => b.updatedAt - a.updatedAt)

      if (resources.length === 0) {
        return {
          resultForModel:
            'No cached resources are attached to this conversation. Use fetch_url, file_read, or another source tool if you need new context.',
          resultForUi: {
            title: 'Cached Resources',
            summary: 'No cached resources attached to this conversation'
          }
        }
      }

      const lines = [`Cached resources attached to this conversation (${resources.length}):`, '']

      resources.slice(0, 50).forEach((resource, index) => {
        const ranges = formatResourceRanges(resource.fetchedRanges)
        const offsets = formatResourceOffsets(resource.chunks || [])
        lines.push(`${index + 1}. ${resource.title || 'Untitled'}`)
        lines.push(`   resourceId: ${resource.id}`)
        lines.push(`   kind: ${resource.kind}`)
        lines.push(`   source: ${resource.source}`)
        lines.push(`   status: ${resource.status}`)
        if (resource.totalChars !== undefined) lines.push(`   totalChars: ${resource.totalChars}`)
        if (ranges) lines.push(`   cachedRanges: ${ranges}`)
        if (offsets) lines.push(`   readableOffsets: ${offsets}`)
        if (resource.nextOffset !== undefined) lines.push(`   nextOffset: ${resource.nextOffset}`)
        if (resource.summary) lines.push(`   summary: ${resource.summary}`)
        lines.push(
          `   To read: read_cached_resource {"resourceId":"${resource.id}","offset":${resource.chunks?.[0]?.offset ?? 0}}`
        )
        lines.push('')
      })

      if (resources.length > 50) {
        lines.push(`${resources.length - 50} additional resources omitted from this listing.`)
      }

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'Cached Resources',
          summary: `Listed ${resources.length} cached resources`
        }
      }
    }
  },
  read_cached_resource: {
    name: 'read_cached_resource',
    title: 'Read Cached Resource',
    description:
      'Reads the full text content of a previously fetched resource chunk using its resourceId and offset from the local cache.',
    tags: ['cache', 'resource', 'read', 'local', 'history', '缓存', '资源', '读取'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description:
            'The unique ID of the cached resource. Use list_cached_resources to discover IDs.'
        },
        offset: {
          type: 'number',
          description:
            'The starting character offset of the chunk to read. Use list_cached_resources to discover readable offsets.'
        }
      },
      required: ['resourceId', 'offset']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const resourceId = args.resourceId
      const offset = args.offset
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      if (typeof offset !== 'number' || !Number.isFinite(offset)) {
        throw new Error('Missing or invalid offset parameter')
      }

      console.log(
        `[read_cached_resource] Reading cached resource ${resourceId} at offset ${offset}`
      )
      const chunk = await readResourceChunkWindow(resourceId, offset)
      const warning = chunk.warning ? `\nWarning: ${chunk.warning}` : ''

      return {
        resultForModel: `Resource ID: ${resourceId}\nRequested Offset: ${chunk.requestedOffset}\nReturned Offset: ${chunk.offset}-${chunk.endOffset}${warning}\n\nContent:\n${chunk.text}`,
        resultForUi: {
          title: `Read Cached Resource: ${resourceId}`,
          summary: chunk.warning
            ? `Adjusted offset ${chunk.requestedOffset} to ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
            : `Read cached chunk at offset ${chunk.offset}-${chunk.endOffset} (${chunk.text.length} characters)`
        }
      }
    }
  },
  search_cached_resource: {
    name: 'search_cached_resource',
    title: 'Search Cached Resource',
    description:
      'Searches inside a previously cached resource using a query string to find matching offsets and snippets.',
    tags: [
      'cache',
      'resource',
      'search',
      'find',
      'local',
      'history',
      '缓存',
      '资源',
      '搜索',
      '查找'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'The unique ID of the cached resource.'
        },
        query: {
          type: 'string',
          description: 'The search query or keywords to locate inside the resource text.'
        }
      },
      required: ['resourceId', 'query']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const resourceId = args.resourceId
      const query = args.query
      if (typeof resourceId !== 'string' || !resourceId) {
        throw new Error('Missing or invalid resourceId parameter')
      }
      if (typeof query !== 'string' || !query) {
        throw new Error('Missing or invalid query parameter')
      }

      const resourceData = loadResourceCache(resourceId)
      if (!resourceData) {
        throw new Error(`Resource cache not found for ID: ${resourceId}`)
      }

      const queryLower = query.toLowerCase()
      const matches: Array<{ offset: number; endOffset: number; snippet: string }> = []

      for (const chunk of resourceData.chunks) {
        if (!chunk.text) continue
        const textLower = chunk.text.toLowerCase()
        const idx = textLower.indexOf(queryLower)
        if (idx !== -1) {
          const matchStart = Math.max(0, idx - 60)
          const matchEnd = Math.min(chunk.text.length, idx + query.length + 90)
          let snippet = chunk.text.substring(matchStart, matchEnd)
          if (matchStart > 0) snippet = '...' + snippet
          if (matchEnd < chunk.text.length) snippet = snippet + '...'
          matches.push({
            offset: chunk.offset || 0,
            endOffset: chunk.endOffset || 0,
            snippet
          })
        }
      }

      if (matches.length === 0) {
        const words = queryLower.split(/\s+/).filter((w) => w.length > 1)
        for (const chunk of resourceData.chunks) {
          if (!chunk.text) continue
          const textLower = chunk.text.toLowerCase()
          for (const word of words) {
            const idx = textLower.indexOf(word)
            if (idx !== -1) {
              const matchStart = Math.max(0, idx - 60)
              const matchEnd = Math.min(chunk.text.length, idx + word.length + 90)
              let snippet = chunk.text.substring(matchStart, matchEnd)
              if (matchStart > 0) snippet = '...' + snippet
              if (matchEnd < chunk.text.length) snippet = snippet + '...'
              matches.push({
                offset: chunk.offset || 0,
                endOffset: chunk.endOffset || 0,
                snippet
              })
              break
            }
          }
        }
      }

      if (matches.length === 0) {
        return {
          resultForModel: `No matches found for query "${query}" in cached resource ${resourceId}.`,
          resultForUi: {
            title: `Search Cache: ${query}`,
            summary: `No matches found`
          }
        }
      }

      const bodyLines = [
        `Search results for query "${query}" in cached resource ${resourceId}:`,
        ''
      ]
      matches.forEach((m, index) => {
        bodyLines.push(`${index + 1}. Chunk Offset: ${m.offset}-${m.endOffset}`)
        bodyLines.push(`   Snippet: "${m.snippet.replace(/\r?\n/g, ' ')}"`)
        bodyLines.push(
          `   Instruction: To read the full details, call read_cached_resource with {"resourceId":"${resourceId}","offset":${m.offset}}`
        )
        bodyLines.push('')
      })

      return {
        resultForModel: bodyLines.join('\n'),
        resultForUi: {
          title: `Search Cache: "${query}"`,
          summary: `Found ${matches.length} matching offsets`
        }
      }
    }
  },
  read_tool_output: {
    name: 'read_tool_output',
    title: 'Read Truncated Tool Output',
    description:
      'Retrieve the full text of an earlier tool result that was truncated to fit the context window. Use the output_id shown in the truncation marker; page through long output with offset.',
    tags: [
      'tool',
      'output',
      'truncated',
      'retrieve',
      'read',
      'history',
      '工具',
      '输出',
      '截断',
      '读取'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        output_id: {
          type: 'string',
          description: 'The id from the truncation marker (the originating tool call id).'
        },
        offset: {
          type: 'number',
          description: 'Starting character offset to read from. Defaults to 0.'
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to return in this window (1000-16000). Defaults to 8000.'
        }
      },
      required: ['output_id']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const outputId = typeof args.output_id === 'string' ? args.output_id : ''
      if (!outputId) {
        throw new Error('Missing or invalid output_id parameter')
      }

      const run = getRun(ctx.reqId)
      const full = run?.getToolOutput(outputId)
      if (full === undefined) {
        return {
          resultForModel: `No stored tool output found for output_id "${outputId}". It may have expired or never been preserved.`,
          resultForUi: {
            title: `Read Tool Output: ${outputId}`,
            summary: 'No stored output found'
          }
        }
      }

      const rawOffset =
        typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0
      const offset = Math.max(0, Math.min(Math.floor(rawOffset), full.length))
      const rawMax =
        typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) ? args.maxChars : 8000
      const maxChars = Math.min(16000, Math.max(1000, Math.floor(rawMax)))

      const slice = full.slice(offset, offset + maxChars)
      const endOffset = offset + slice.length
      const nextOffset = endOffset < full.length ? endOffset : undefined

      const header = `Tool output ${outputId} (chars ${offset}-${endOffset} of ${full.length})${
        nextOffset !== undefined ? `\nMore available: call again with offset=${nextOffset}.` : ''
      }`

      return {
        resultForModel: `${header}\n\nContent:\n${slice}`,
        resultForUi: {
          title: `Read Tool Output: ${outputId}`,
          summary: `Returned chars ${offset}-${endOffset} of ${full.length}`
        }
      }
    }
  },
  task: {
    name: 'task',
    title: 'Task Tracker',
    description:
      'Track progress on complex multi-step tasks. Create a structured task list at the start of non-trivial work and update individual step statuses as you go. The task list appears in the UI so the user can follow your progress. Tasks with duplicate IDs update the existing entry; new IDs are appended. Mark a task completed only after the underlying work has actually been performed.',
    tags: ['task', 'todo', 'plan', 'track', 'progress', '任务', '计划', '追踪'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Optional short single task title. Do not pass JSON, code, markdown, or a serialized task list here; use tasks for lists.'
        },
        title: {
          type: 'string',
          description:
            'Optional short single task title. Equivalent to task; useful when sending one task object.'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description:
            'Optional status for a single task title. Defaults to in_progress for one task.'
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short stable id (e.g. "1", "search", "fix").' },
              title: { type: 'string', description: 'Brief description of this step.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.'
              }
            },
            required: ['id', 'title', 'status']
          },
          description:
            'The task list. Provide the COMPLETE list on first call; on subsequent calls only include items whose status changed. Use completed only after the work is actually done, not as a planning placeholder.'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const incoming = normalizeTaskArgs(args)
      if (incoming.length === 0) {
        throw new Error(
          'No valid task items found. Expected { "tasks": [{ "id": "1", "title": "...", "status": "pending|in_progress|completed|cancelled" }] }, or a short single task title. Do not pass JSON/code as a task title.'
        )
      }

      const run = getRun(ctx.reqId)
      if (!run) {
        throw new Error('No active agent run — tasks are only available during an agent session.')
      }

      const merged = run.mergeTasks(incoming)

      // Push to the renderer so the task list renders in the conversation UI.
      if (ctx.mainWindow) {
        ctx.mainWindow.webContents.send('chat-chunk', {
          reqId: ctx.reqId,
          event: { type: 'task_update', tasks: merged }
        })
      }

      const lines = ['Tasks:']
      const statusIcon: Record<string, string> = {
        pending: '○',
        in_progress: '◐',
        completed: '●',
        cancelled: '✕'
      }
      for (const t of merged) {
        lines.push(`  ${statusIcon[t.status] || '○'} ${t.id}: ${t.title} [${t.status}]`)
      }

      const doneCount = merged.filter(
        (t) => t.status === 'completed' || t.status === 'cancelled'
      ).length
      const total = merged.length

      return {
        resultForModel: `${lines.join('\n')}\n\nProgress: ${doneCount}/${total} done. Update task statuses with this tool as you complete each step. Use completed only after the underlying work is actually performed and verified; leave unfinished or unverified work pending/in_progress/cancelled.`,
        resultForUi: {
          title: 'Tasks',
          summary: `${doneCount}/${total} done`
        }
      }
    }
  },
  inspect_environment: {
    name: 'inspect_environment',
    title: 'Inspect Environment',
    description:
      'Detect the user\'s machine environment in one read-only call: OS and shell, which developer tools are installed and their versions (git, node, python, conda, java, go, docker, etc.), the default python interpreter and conda environments, and which standard folders exist (Desktop/Documents/Downloads — existence only, contents are never listed). Use this instead of blindly probing through the shell, which is slower and triggers permission prompts. After learning durable facts, persist the reusable ones with write_memory (e.g. an "environment" task group).',
    tags: [
      'environment',
      'machine',
      'tools',
      'installed',
      'python',
      'conda',
      'git',
      'detect',
      'probe',
      '环境',
      '工具',
      '检测',
      '电脑'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: { type: 'string', enum: ['os', 'tools', 'envs', 'dirs'] },
          description:
            'Optional subset of sections to probe: os, tools, envs, dirs. Omit to probe all.'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const valid: ProbeSection[] = ['os', 'tools', 'envs', 'dirs']
      const include = Array.isArray(args.include)
        ? args.include.filter(
            (s): s is ProbeSection => typeof s === 'string' && (valid as string[]).includes(s)
          )
        : valid
      const sections = include.length > 0 ? include : valid

      const snapshot = await probeEnvironment(ctx.signal)
      const report = formatEnvironmentReport(snapshot, sections)

      const toolCount = snapshot.tools.filter((t) => t.found).length
      const dirCount = snapshot.dirs.filter((d) => d.exists).length

      return {
        resultForModel: report,
        resultForUi: {
          title: 'Inspect Environment',
          summary: `Detected ${toolCount} tools, ${dirCount} standard folders`
        }
      }
    }
  },
  schedule_reminder: {
    name: 'schedule_reminder',
    title: 'Schedule Reminder',
    description:
      'Schedule a desktop notification after a delay. Use for requests like "remind me in 10 minutes to drink water". The reminder is an in-app timer and requires QuickAI to remain running until it fires.',
    tags: [
      'reminder',
      'timer',
      'alarm',
      'schedule',
      'notify',
      'delay',
      '提醒',
      '定时',
      '闹钟',
      '通知'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        delaySeconds: {
          type: 'number',
          description:
            'Delay before the notification fires, in seconds. Example: 600 for 10 minutes.'
        },
        title: {
          type: 'string',
          description: 'Optional notification title. Defaults to "Reminder".'
        },
        message: {
          type: 'string',
          description: 'Reminder message to show in the desktop notification.'
        }
      },
      required: ['delaySeconds', 'message']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const reminder = scheduleDesktopReminder({
        delaySeconds: args.delaySeconds,
        title: args.title,
        message: args.message,
        onClick: getReminderClickHandler(ctx)
      })
      const delayText = formatReminderDelay(reminder.triggerAt - Date.now())
      const triggerAt = new Date(reminder.triggerAt).toISOString()

      return {
        resultForModel: [
          'Reminder scheduled.',
          `Reminder ID: ${reminder.id}`,
          `Message: ${reminder.message}`,
          `Trigger time: ${triggerAt}`,
          `Delay: ${delayText}`,
          'Note: QuickAI must remain running for this in-app reminder to fire.'
        ].join('\n'),
        resultForUi: {
          title: 'Reminder Scheduled',
          summary: `${reminder.message} in ${delayText}`
        }
      }
    }
  },
  list_reminders: {
    name: 'list_reminders',
    title: 'List Reminders',
    description:
      'List pending in-app reminder timers that will send desktop notifications while QuickAI remains running.',
    tags: ['reminder', 'timer', 'alarm', 'schedule', 'list', '提醒', '定时', '闹钟'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void args
      void ctx
      const reminders = listPendingReminders()
      if (reminders.length === 0) {
        return {
          resultForModel: 'No pending reminders.',
          resultForUi: {
            title: 'Reminders',
            summary: 'No pending reminders'
          }
        }
      }

      return {
        resultForModel: ['Pending reminders:', ...reminders.map(formatReminderLine)].join('\n'),
        resultForUi: {
          title: 'Reminders',
          summary: `${reminders.length} pending reminder${reminders.length === 1 ? '' : 's'}`
        }
      }
    }
  },
  cancel_reminder: {
    name: 'cancel_reminder',
    title: 'Cancel Reminder',
    description: 'Cancel a pending in-app reminder by reminderId.',
    tags: ['reminder', 'timer', 'alarm', 'schedule', 'cancel', '提醒', '定时', '闹钟'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        reminderId: {
          type: 'string',
          description: 'Reminder ID returned by schedule_reminder or shown by list_reminders.'
        }
      },
      required: ['reminderId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const reminderId =
        typeof args.reminderId === 'string' && args.reminderId.trim() ? args.reminderId.trim() : ''
      if (!reminderId) {
        throw new Error('Missing or invalid reminderId parameter')
      }

      const reminder = cancelDesktopReminder(reminderId)
      if (!reminder) {
        throw new Error(`Reminder not found: ${reminderId}`)
      }

      return {
        resultForModel: `Cancelled reminder ${reminder.id}: "${reminder.message}"`,
        resultForUi: {
          title: 'Reminder Cancelled',
          summary: reminder.message
        }
      }
    }
  },
  notify: {
    name: 'notify',
    title: 'Notify',
    description:
      'Send a desktop notification to the user. Use this to alert the user when a long-running task completes, when you have important results, or when you need the user to check something. The notification appears in the OS notification center.',
    tags: ['notification', 'alert', 'notify', 'message', '桌面通知'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Notification title — keep it short and descriptive.'
        },
        body: {
          type: 'string',
          description: 'Notification body — the main message.'
        }
      },
      required: ['title', 'body']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const title =
        typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'QuickAI'
      const body = typeof args.body === 'string' ? args.body.trim() : ''

      const sent = showDesktopNotification(title, body)

      return {
        resultForModel: sent
          ? `Notification sent: "${title}"`
          : 'Notification not supported on this system.',
        resultForUi: {
          title: 'Notification',
          summary: sent ? title : 'Notifications unsupported'
        }
      }
    }
  },
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

      return {
        resultForModel: `Created QuickAI skill:\nID: ${skill.id}\nTrigger: @${skill.trigger}\nDirectory: ${skillDir}\nNext: call load_skill with "${skill.trigger}" or validate_skill with "${skill.id}".`,
        resultForUi: {
          title: `Create Skill: ${skill.name}`,
          url: `file:///${skillDir.replace(/\\/g, '/')}`,
          summary: `Created ${skill.id} (@${skill.trigger})`
        }
      }
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
        return {
          resultForModel: `Skill is already installed:\nID: ${skill.id}\nName: ${skill.name}\nTrigger: @${skill.trigger}\nDirectory: ${destinationDir}`,
          resultForUi: {
            title: `Install Skill: ${skill.name}`,
            url: `file:///${destinationDir.replace(/\\/g, '/')}`,
            summary: `Already installed ${skill.id} (@${skill.trigger})`
          }
        }
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

      return {
        resultForModel: `Installed QuickAI skill:\nID: ${skill.id}\nName: ${skill.name}\nTrigger: @${skill.trigger}\nDirectory: ${destinationDir}\nNext: call list_skills to confirm the live catalog.`,
        resultForUi: {
          title: `Install Skill: ${skill.name}`,
          url: `file:///${destinationDir.replace(/\\/g, '/')}`,
          summary: `Installed ${skill.id} (@${skill.trigger})`
        }
      }
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

      return {
        resultForModel: `Removed QuickAI skill:\nID: ${skill.id}\nPath: ${targetPath}`,
        resultForUi: {
          title: `Remove Skill: ${getSkillDisplayName(skill)}`,
          summary: `Removed ${skill.id}`
        }
      }
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

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: name ? `Validate Skill: ${name}` : 'Validate Skills',
          summary: `${targets.length} skill(s), ${issueCount} issue(s)`
        }
      }
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

      return {
        resultForModel: `Loaded QuickAI Skill. Follow these instructions for the current user request. Auxiliary package files are listed but not loaded; call read_skill_resource for a listed Path when needed.\n\n${formatSkillForModel(skill, false)}`,
        resultForUi: {
          title: `Load Skill: ${getSkillDisplayName(skill)}`,
          summary: `Loaded ${skill.id}`
        }
      }
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

      return {
        resultForModel: `Skill Resource: ${skill.id}\nPath: ${resource.path}\nChars: ${offset}-${endOffset} of ${full.length}${
          nextOffset !== undefined ? `\nMore available: call again with offset=${nextOffset}.` : ''
        }\n\nContent:\n${slice}`,
        resultForUi: {
          title: `Skill Resource: ${resource.path}`,
          summary: `${skill.id} chars ${offset}-${endOffset}`
        }
      }
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

        return {
          resultForModel: formatSkillForModel(s, false),
          resultForUi: {
            title: `Skill Details: ${getSkillDisplayName(s)}`,
            summary: `Loaded details for skill ${s.id}`
          }
        }
      }

      if (skills.length === 0) {
        return {
          resultForModel: 'No custom skills installed.',
          resultForUi: {
            title: 'List Skills',
            summary: '0 skills installed'
          }
        }
      }

      const lines = ['Installed Skills:']
      const items = skills.map((s) => {
        const triggersStr = s.triggers && s.triggers.length > 0 ? s.triggers.join(', ') : s.trigger
        const displayName = getSkillDisplayName(s)
        const shortDescription = getSkillShortDescription(s)
        lines.push(`- ID: ${s.id}`)
        lines.push(`  Name: ${displayName}`)
        if (displayName !== s.name) lines.push(`  Internal Name: ${s.name}`)
        lines.push(`  Triggers: ${triggersStr}`)
        if (shortDescription) lines.push(`  Description: ${shortDescription}`)
        if (s.filePath) lines.push(`  File Path: ${s.filePath}`)
        if (s.dirPath) lines.push(`  Directory Path: ${s.dirPath}`)
        lines.push(`  Mode: ${s.mode || 'insert'}`)
        lines.push(`  Kind: ${s.kind || 'prompt'}`)
        if (s.tools && s.tools.length > 0) lines.push(`  Declared Tools: ${s.tools.join(', ')}`)
        lines.push('')

        return {
          title: displayName,
          url: s.filePath ? `file:///${s.filePath.replace(/\\/g, '/')}` : '',
          snippet: `Triggers: ${triggersStr} | Mode: ${s.mode || 'insert'}${shortDescription ? ` | ${shortDescription}` : ''}`,
          source: s.source || 'markdown'
        }
      })

      return {
        resultForModel: lines.join('\n'),
        resultForUi: {
          title: 'List Skills',
          summary: `Found ${skills.length} skills`,
          items
        }
      }
    }
  }
}
