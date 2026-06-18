import { execFileSync, spawn } from 'child_process'
import { ToolArgs } from '../../shared/types'
import { ToolDefinition, ToolExecutionContext } from './types'
import { getWorkspaceRoot } from './helpers'
import { getRun } from '../agent/AgentRunContext'

const WINDOWS_CODE_PAGE_ENCODINGS: Record<string, string> = {
  '65001': 'utf-8',
  '936': 'gbk',
  '54936': 'gb18030',
  '950': 'big5',
  '932': 'shift_jis',
  '949': 'euc-kr',
  '874': 'windows-874',
  '1250': 'windows-1250',
  '1251': 'windows-1251',
  '1252': 'windows-1252',
  '1253': 'windows-1253',
  '1254': 'windows-1254',
  '1255': 'windows-1255',
  '1256': 'windows-1256',
  '1257': 'windows-1257',
  '1258': 'windows-1258'
}

let cachedShellFallbackEncoding: string | undefined
const SHELL_TIMEOUT_MS = 60000
const SHELL_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const SHELL_OUTPUT_FLUSH_MS = 100
const SHELL_LIVE_PREVIEW_CHARS = 64 * 1024

function decodeBuffer(buffer: Buffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function countReplacementChars(value: string): number {
  return (value.match(/\uFFFD/g) || []).length
}

function getShellFallbackEncoding(): string {
  if (process.platform !== 'win32') return 'utf-8'
  if (cachedShellFallbackEncoding) return cachedShellFallbackEncoding

  try {
    const output = execFileSync('cmd.exe', ['/d', '/c', 'chcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000
    })
    const codePage = output.match(/(\d+)/)?.[1]
    cachedShellFallbackEncoding = codePage ? WINDOWS_CODE_PAGE_ENCODINGS[codePage] || 'gbk' : 'gbk'
  } catch {
    cachedShellFallbackEncoding = 'gbk'
  }

  return cachedShellFallbackEncoding
}

export function decodeShellOutputForDisplay(
  output: string | Buffer,
  fallbackEncoding = getShellFallbackEncoding()
): string {
  if (typeof output === 'string') return output
  if (output.length === 0) return ''

  const utf8Text = decodeBuffer(output, 'utf-8')
  const utf8ReplacementCount = countReplacementChars(utf8Text)
  if (utf8ReplacementCount === 0 || fallbackEncoding.toLowerCase() === 'utf-8') {
    return utf8Text
  }

  const fallbackText = decodeBuffer(output, fallbackEncoding)
  return countReplacementChars(fallbackText) <= utf8ReplacementCount ? fallbackText : utf8Text
}

function trimLivePreview(details: string): string {
  if (details.length <= SHELL_LIVE_PREVIEW_CHARS) return details
  return `[Live output preview truncated to last ${SHELL_LIVE_PREVIEW_CHARS} chars]\n${details.slice(-SHELL_LIVE_PREVIEW_CHARS)}`
}

function buildShellDetails(args: {
  root: string
  code?: number
  durationMs?: number
  status?: string
  stdoutText?: string
  stderrText?: string
  executionError?: string
}): string {
  const lines = [
    `Cwd: ${args.root}`,
    args.code !== undefined ? `Exit Code: ${args.code}` : '',
    args.durationMs !== undefined ? `Duration: ${args.durationMs}ms` : '',
    args.status ? `Status: ${args.status}` : ''
  ].filter(Boolean)

  if (args.stdoutText) {
    lines.push('', `Stdout:\n${args.stdoutText.trimEnd()}`)
  }
  if (args.stderrText) {
    lines.push('', `Stderr:\n${args.stderrText.trimEnd()}`)
  }
  if (args.executionError) {
    lines.push('', `Execution Error:\n${args.executionError}`)
  }

  return lines.join('\n')
}

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
