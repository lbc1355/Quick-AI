import { exec } from 'child_process'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getWorkspaceRoot } from './helpers'
import { getRun } from '../agent/AgentRunContext'

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
      const command = args.command
      if (typeof command !== 'string' || !command) {
        throw new Error('Missing or invalid command parameter')
      }

      if (ctx.signal?.aborted) {
        return {
          resultForModel: `Command: ${command}\nExecution Error: Command execution cancelled.`,
          resultForUi: {
            title: `Execute Command: ${command}`,
            summary: `Command execution cancelled`
          }
        }
      }

      const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
      const root = runCtx?.projectRoot || getWorkspaceRoot()
      const TIMEOUT_MS = 60000

      return new Promise((resolvePromise) => {
        const startTime = Date.now()
        exec(
          command,
          {
            cwd: root,
            signal: ctx.signal,
            timeout: TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024
          },
          (error, stdout, stderr) => {
            const durationMs = Date.now() - startTime
            const code = error ? (error.code ?? 1) : 0

            const isCancelled =
              !!ctx.signal?.aborted ||
              !!(error && (error.name === 'AbortError' || String(error.code) === 'ABORT_ERR'))

            const isTimedOut =
              !isCancelled &&
              !!error &&
              (error as { killed?: boolean }).killed === true &&
              (error.signal === 'SIGTERM' || error.signal === 'SIGKILL')

            let status: 'cancelled' | 'timeout' | 'ok' = 'ok'
            if (isCancelled) status = 'cancelled'
            else if (isTimedOut) status = 'timeout'

            let resultText = `Command: ${command}\nCwd: ${root}\nExit Code: ${code}\nDuration: ${durationMs}ms\n\n`
            if (status === 'cancelled') {
              resultText += `Status: Command execution was cancelled.\n`
            } else if (status === 'timeout') {
              resultText += `Status: Command timed out after ${TIMEOUT_MS}ms and was terminated.\n`
            }
            if (stdout) {
              resultText += `Stdout:\n${stdout}\n`
            }
            if (stderr) {
              resultText += `Stderr:\n${stderr}\n`
            }
            if (
              status === 'ok' &&
              error &&
              error.message &&
              !error.message.includes('Command failed')
            ) {
              resultText += `Execution Error:\n${error.message}\n`
            }

            const title = `Execute Command: ${
              command.length > 50 ? command.slice(0, 47) + '...' : command
            }`
            let summary: string
            if (status === 'cancelled') {
              summary = `Command execution cancelled after ${durationMs}ms`
            } else if (status === 'timeout') {
              summary = `Command timed out after ${durationMs}ms`
            } else {
              summary = `Command exited with code ${code} after ${durationMs}ms`
            }

            resolvePromise({
              resultForModel: resultText,
              resultForUi: {
                title,
                summary
              }
            })
          }
        )
      })
    }
  }
}
