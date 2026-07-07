import { ToolArgs } from '../../shared/types'
import {
  executeBackgroundShellList,
  executeBackgroundShellRead,
  executeBackgroundShellStart,
  executeBackgroundShellStop
} from './backgroundShell'
import { executeShellCommand } from './shellExecutor'
import { ToolDefinition, ToolExecutionContext } from './types'
export { decodeShellOutputForDisplay } from './shellEncoding'

export const shellTools: Record<string, ToolDefinition> = {
  shell: {
    name: 'shell',
    title: 'Execute Shell Command',
    description: 'Executes a command line instruction in the workspace root directory.',
    tags: ['shell', 'exec', 'command', 'terminal'],
    category: 'shell',
    risk: 'high',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' },
        background: {
          type: 'boolean',
          description:
            'Optional. If true, starts the command in the background and returns a background processId immediately. Use this for dev servers, watchers, long-running processes (e.g. npm run dev). Defaults to false.'
        },
        waitMs: {
          type: 'number',
          description:
            'Optional (only applicable when background is true). Initial wait in milliseconds to capture startup output before returning. Defaults to 500, max 5000.'
        },
        maxChars: {
          type: 'number',
          description:
            'Optional (only applicable when background is true). Max startup output characters to return. Defaults to 16000.'
        }
      },
      required: ['command']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const rawCommand = args.command
      if (typeof rawCommand !== 'string' || !rawCommand) {
        throw new Error('Missing or invalid command parameter')
      }
      const command = rawCommand

      if (ctx.signal?.aborted) {
        return {
          resultForModel: `Command: ${command}\nExecution Error: Command execution cancelled.`,
          resultForUi: {
            title: `Execute Command: ${command}`,
            summary: `Command execution cancelled`,
            details: 'Status: Command execution cancelled.'
          }
        }
      }

      if (args.background === true) {
        return executeBackgroundShellStart(args, ctx)
      }

      return executeShellCommand(command, ctx)
    }
  },
  shell_background_read: {
    name: 'shell_background_read',
    title: 'Read Background Shell Output',
    description:
      'Reads buffered stdout/stderr from a background shell process by processId. Use offset and nextOffset to page through output.',
    tags: ['shell', 'background', 'read', 'output', 'logs'],
    category: 'shell',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        processId: {
          type: 'string',
          description: 'The background processId returned by shell_background_start.'
        },
        offset: {
          type: 'number',
          description:
            'Optional output character offset. Omit to read the latest buffered output tail.'
        },
        maxChars: {
          type: 'number',
          description: 'Optional max output characters to return. Defaults to 16000, max 64000.'
        }
      },
      required: ['processId']
    },
    execute: executeBackgroundShellRead
  },
  shell_background_stop: {
    name: 'shell_background_stop',
    title: 'Stop Background Shell Process',
    description:
      'Stops a background shell process by processId. On Windows it terminates the process tree so npm/node dev servers do not keep running.',
    tags: ['shell', 'background', 'stop', 'kill', 'process'],
    category: 'shell',
    risk: 'medium',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        processId: {
          type: 'string',
          description: 'The background processId returned by shell_background_start.'
        },
        offset: {
          type: 'number',
          description: 'Optional output character offset to include with the stop result.'
        },
        maxChars: {
          type: 'number',
          description: 'Optional max output characters to return. Defaults to 16000, max 64000.'
        }
      },
      required: ['processId']
    },
    execute: executeBackgroundShellStop
  },
  shell_background_list: {
    name: 'shell_background_list',
    title: 'List Background Shell Processes',
    description:
      'Lists background shell processes started in this app session, including processId, status, PID, command, and output size.',
    tags: ['shell', 'background', 'list', 'processes'],
    category: 'shell',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: executeBackgroundShellList
  }
}
