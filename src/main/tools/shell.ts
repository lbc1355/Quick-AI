import { spawn } from 'child_process'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getWorkspaceRoot } from './helpers'
import { getRun } from '../agent/AgentRunContext'
import { decodeShellOutputForDisplay, getShellFallbackEncoding } from './shellEncoding'
import { buildShellDetails, trimLivePreview } from './shellResult'
export { decodeShellOutputForDisplay } from './shellEncoding'

const SHELL_TIMEOUT_MS = 60000
const SHELL_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const SHELL_OUTPUT_FLUSH_MS = 100

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

      const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
      const root = runCtx?.projectRoot || getWorkspaceRoot()

      return new Promise((resolvePromise) => {
        const startTime = Date.now()
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        const fallbackEncoding = getShellFallbackEncoding()
        let outputBytes = 0
        let finished = false
        let timedOut = false
        let outputLimitExceeded = false
        let spawnError: Error | undefined
        let flushTimer: NodeJS.Timeout | undefined
        let timeout: NodeJS.Timeout | undefined
        let resolved = false

        const child = spawn(command, {
          cwd: root,
          shell: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        const decodeStdout = (): string =>
          decodeShellOutputForDisplay(Buffer.concat(stdoutChunks), fallbackEncoding)
        const decodeStderr = (): string =>
          decodeShellOutputForDisplay(Buffer.concat(stderrChunks), fallbackEncoding)

        const flushLiveOutput = (): void => {
          flushTimer = undefined
          if (!ctx.emitOutput || finished) return
          const details = buildShellDetails({
            root,
            status: 'Running...',
            stdoutText: decodeStdout(),
            stderrText: decodeStderr()
          })
          ctx.emitOutput({
            stream: 'stdout',
            content: trimLivePreview(details),
            replace: true
          })
        }

        const scheduleLiveOutputFlush = (): void => {
          if (!ctx.emitOutput || flushTimer || finished) return
          flushTimer = setTimeout(flushLiveOutput, SHELL_OUTPUT_FLUSH_MS)
        }

        const appendOutput = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
          outputBytes += chunk.length
          if (stream === 'stdout') stdoutChunks.push(chunk)
          else stderrChunks.push(chunk)

          scheduleLiveOutputFlush()

          if (outputBytes > SHELL_MAX_OUTPUT_BYTES && !outputLimitExceeded) {
            outputLimitExceeded = true
            child.kill()
            finish(1)
          }
        }

        const abortHandler = (): void => {
          child.kill()
          finish(1)
        }

        function finish(code: number | null): void {
          if (resolved) return
          resolved = true
          finished = true
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = undefined
          }
          if (timeout) {
            clearTimeout(timeout)
            timeout = undefined
          }
          ctx.signal?.removeEventListener('abort', abortHandler)

          const durationMs = Date.now() - startTime
          const exitCode = code ?? (ctx.signal?.aborted || timedOut || outputLimitExceeded ? 1 : 0)
          const stdoutText = decodeStdout()
          const stderrText = decodeStderr()
          const isCancelled = !!ctx.signal?.aborted

          let status: 'cancelled' | 'timeout' | 'output_limit' | 'ok' = 'ok'
          if (isCancelled) status = 'cancelled'
          else if (timedOut) status = 'timeout'
          else if (outputLimitExceeded) status = 'output_limit'

          let statusText = ''
          if (status === 'cancelled') {
            statusText = 'Command execution was cancelled.'
          } else if (status === 'timeout') {
            statusText = `Command timed out after ${SHELL_TIMEOUT_MS}ms and was terminated.`
          } else if (status === 'output_limit') {
            statusText = `Command exceeded the ${SHELL_MAX_OUTPUT_BYTES} byte output limit and was terminated.`
          }

          const details = buildShellDetails({
            root,
            code: exitCode,
            durationMs,
            status: statusText,
            stdoutText,
            stderrText,
            executionError: status === 'ok' ? spawnError?.message : undefined
          })

          const resultText = `Command: ${command}\n${details}\n`
          const title = `Execute Command: ${
            command.length > 50 ? command.slice(0, 47) + '...' : command
          }`
          let summary: string
          if (status === 'cancelled') {
            summary = `Command execution cancelled after ${durationMs}ms`
          } else if (status === 'timeout') {
            summary = `Command timed out after ${durationMs}ms`
          } else if (status === 'output_limit') {
            summary = `Command exceeded output limit after ${durationMs}ms`
          } else {
            summary = `Command exited with code ${exitCode} after ${durationMs}ms`
          }

          resolvePromise({
            resultForModel: resultText,
            resultForUi: {
              title,
              summary,
              details
            }
          })
        }

        child.stdout?.on('data', (chunk: Buffer) => appendOutput('stdout', chunk))
        child.stderr?.on('data', (chunk: Buffer) => appendOutput('stderr', chunk))

        timeout = setTimeout(() => {
          timedOut = true
          child.kill()
          finish(1)
        }, SHELL_TIMEOUT_MS)

        ctx.signal?.addEventListener('abort', abortHandler, { once: true })

        child.on('error', (error) => {
          spawnError = error
          finish(1)
        })

        child.on('close', (code) => {
          finish(code)
        })
      })
    }
  }
}
