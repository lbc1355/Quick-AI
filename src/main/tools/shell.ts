import { ToolArgs } from '../../shared/types'
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
        command: { type: 'string', description: 'The command to run.' }
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

      return executeShellCommand(command, ctx)
    }
  }
}
