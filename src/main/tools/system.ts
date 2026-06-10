import { ToolArgs, TaskItem } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { showDesktopNotification } from './helpers'
import { probeEnvironment, formatEnvironmentReport, ProbeSection } from './environmentProbe'
import { readResourceChunk } from '../resourceCache'
import { loadResourceCache } from '../database'
import { getRun } from '../agent/AgentRunContext'

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
      },
      required: ['tasks']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const raw = args.tasks
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Missing or invalid tasks parameter — expected a non-empty array.')
      }

      const incoming: TaskItem[] = []
      for (const item of raw) {
        if (
          typeof item !== 'object' ||
          !item ||
          typeof item.id !== 'string' ||
          !item.id.trim() ||
          typeof item.title !== 'string' ||
          typeof item.status !== 'string'
        ) {
          continue
        }
        const status = item.status as TaskItem['status']
        if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) continue
        incoming.push({ id: item.id.trim(), title: item.title.trim(), status })
      }

      if (incoming.length === 0) {
        throw new Error('No valid task items found. Each item needs id, title, and status.')
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
  }
}
