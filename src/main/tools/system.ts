import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { showDesktopNotification } from './helpers'
import { probeEnvironment, formatEnvironmentReport, ProbeSection } from './environmentProbe'
import { askUserChoiceTool } from './userChoice'
import { reminderTools } from './reminderTools'
import { resourceTools } from './resourceTools'
import { taskTool } from './taskTool'
import { skillTools } from './skillTools'

export const systemTools: Record<string, ToolDefinition> = {
  ...resourceTools,
  task: taskTool,
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
  ask_user_choice: askUserChoiceTool,
  ...reminderTools,
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
  ...skillTools
}
