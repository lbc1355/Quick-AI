import { Skill, ToolArgs, TaskItem } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { showDesktopNotification } from './helpers'
import { probeEnvironment, formatEnvironmentReport, ProbeSection } from './environmentProbe'
import { readResourceChunk } from '../resourceCache'
import { loadResourceCache } from '../database'
import { getRun } from '../agent/AgentRunContext'
import { loadSkillsFromFolders } from '../skillManager'

const MAX_SKILL_PACKAGE_FILE_CHARS = 6000
const MAX_SKILL_PACKAGE_TOTAL_CHARS = 20000

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

function formatSkillPackageFiles(skill: Skill, includeContent: boolean): string[] {
  const files = (skill.packageFiles || [])
    .filter((file) => file.content.trim())
    .filter((file) => file.path.toLowerCase() !== (skill.entryPath || 'SKILL.md').toLowerCase())
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
  const lines = [
    `Skill ID: ${skill.id}`,
    `Name: ${skill.name}`,
    `Triggers: ${triggers.filter(Boolean).join(', ')}`,
    skill.description ? `Description: ${skill.description}` : '',
    skill.filePath ? `File Path: ${skill.filePath}` : '',
    skill.dirPath ? `Directory Path: ${skill.dirPath}` : '',
    `Mode: ${skill.mode || 'insert'}`,
    `Kind: ${skill.kind || 'prompt'}`,
    skill.tools && skill.tools.length > 0 ? `Declared Tools: ${skill.tools.join(', ')}` : '',
    '',
    '--- SKILL.md Prompt Instructions ---',
    skill.rawMarkdown || skill.prompt,
    '-------------------------------------',
    ...formatSkillPackageFiles(skill, includePackageContent)
  ]

  return lines.filter((line) => line !== '').join('\n')
}

const TASK_STATUSES: TaskItem['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']

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

function normalizeTaskEntry(
  item: unknown,
  index: number,
  fallbackStatus: TaskItem['status']
): TaskItem | undefined {
  if (typeof item === 'string') {
    const title = item.trim()
    if (!title) return undefined
    return {
      id: makeTaskId(title, index),
      title,
      status: fallbackStatus
    }
  }

  if (!isRecord(item)) return undefined

  const titleValue = item.title ?? item.description ?? item.task ?? item.name ?? item.id
  const title = typeof titleValue === 'string' ? titleValue.trim() : ''
  if (!title) return undefined

  const rawId = typeof item.id === 'string' ? item.id.trim() : ''
  return {
    id: rawId || makeTaskId(title, index),
    title,
    status: readTaskStatus(item.status, fallbackStatus)
  }
}

function normalizeTaskArgs(args: unknown): TaskItem[] {
  const source = pickTaskSource(args)
  const entries = Array.isArray(source) ? source : source !== undefined ? [source] : []
  const fallbackStatus = entries.length === 1 ? 'in_progress' : 'pending'
  return entries
    .map((item, index) => normalizeTaskEntry(item, index, fallbackStatus))
    .filter((item): item is TaskItem => Boolean(item))
}

export const systemTools: Record<string, ToolDefinition> = {
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
            'The unique ID of the cached resource (provided in the session resources summary).'
        },
        offset: {
          type: 'number',
          description:
            'The starting character offset of the chunk to read (provided in the session resources summary).'
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
      if (typeof offset !== 'number' || Number.isNaN(offset)) {
        throw new Error('Missing or invalid offset parameter')
      }

      console.log(
        `[read_cached_resource] Reading cached resource ${resourceId} at offset ${offset}`
      )
      const text = await readResourceChunk(resourceId, offset)
      const endOffset = offset + text.length

      return {
        resultForModel: `Resource ID: ${resourceId}\nOffset: ${offset}-${endOffset}\n\nContent:\n${text}`,
        resultForUi: {
          title: `Read Cached Resource: ${resourceId}`,
          summary: `Read cached chunk at offset ${offset}-${endOffset} (${text.length} characters)`
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
      'Track progress on complex multi-step tasks. Create a structured task list at the start of non-trivial work and update individual step statuses as you go. The task list appears in the UI so the user can follow your progress. Tasks with duplicate IDs update the existing entry; new IDs are appended.',
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
            'Optional single task title. Use this for a one-step task when a full tasks array is unnecessary.'
        },
        title: {
          type: 'string',
          description:
            'Optional single task title. Equivalent to task; useful when sending one task object.'
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
            'The task list. Provide the COMPLETE list on first call; on subsequent calls only include items whose status changed.'
        }
      }
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const incoming = normalizeTaskArgs(args)
      if (incoming.length === 0) {
        throw new Error(
          'No valid task items found. Expected { "tasks": [{ "id": "1", "title": "...", "status": "pending|in_progress|completed|cancelled" }] }, or a task title string.'
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
        resultForModel: `${lines.join('\n')}\n\nProgress: ${doneCount}/${total} done. Update task statuses with this tool as you complete each step.`,
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
  load_skill: {
    name: 'load_skill',
    title: 'Load Skill',
    description:
      'Loads the full SKILL.md instructions for an installed QuickAI Skill. Use this when the user mentions @skill, names a skill, or the task matches a skill in the system prompt skill catalog.',
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
            return `${s.name} (${triggers.map((t) => `@${t}`).join(', ')})`
          })
          .join(', ')
        throw new Error(
          available
            ? `Skill "${name}" not found. Available skills: ${available}`
            : `Skill "${name}" not found. No custom skills are installed.`
        )
      }

      return {
        resultForModel: `Loaded QuickAI Skill. Follow these instructions for the current user request.\n\n${formatSkillForModel(skill, true)}`,
        resultForUi: {
          title: `Load Skill: ${skill.name}`,
          summary: `Loaded ${skill.id}`
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
            title: `Skill Details: ${s.name}`,
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
        lines.push(`- ID: ${s.id}`)
        lines.push(`  Name: ${s.name}`)
        lines.push(`  Triggers: ${triggersStr}`)
        if (s.description) lines.push(`  Description: ${s.description}`)
        if (s.filePath) lines.push(`  File Path: ${s.filePath}`)
        if (s.dirPath) lines.push(`  Directory Path: ${s.dirPath}`)
        lines.push(`  Mode: ${s.mode || 'insert'}`)
        lines.push(`  Kind: ${s.kind || 'prompt'}`)
        if (s.tools && s.tools.length > 0) lines.push(`  Declared Tools: ${s.tools.join(', ')}`)
        lines.push('')

        return {
          title: s.name,
          url: s.filePath ? `file:///${s.filePath.replace(/\\/g, '/')}` : '',
          snippet: `Triggers: ${triggersStr} | Mode: ${s.mode || 'insert'}${s.description ? ` | ${s.description}` : ''}`,
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
