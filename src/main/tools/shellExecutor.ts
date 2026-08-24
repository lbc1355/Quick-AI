import { spawn } from 'child_process'
import { getRun } from '../agent/AgentRunContext'
import { assertCommandNotDangerous } from '../agent/commandSafety'
import { getWorkspaceRoot } from './helpers'
import { decodeShellOutputForDisplay, getShellFallbackEncoding } from './shellEncoding'
import { buildShellDetails, trimLivePreview } from './shellResult'
import { ToolExecutionContext, ToolExecutionResult } from './types'

// The tool runtime owns the normal 60s deadline. This later timer is only a direct-call fallback.
const SHELL_FALLBACK_TIMEOUT_MS = 65_000
const SHELL_TERMINATION_GRACE_MS = 2_000
const SHELL_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const SHELL_OUTPUT_FLUSH_MS = 100

export async function executeShellCommand(
  command: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // Defense-in-depth: never let a destructive command reach spawn, even if a caller bypasses the
  // agent-loop guardrail. `requires_approval` commands still execute here; the pipeline gates them.
  assertCommandNotDangerous(command)
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
    let terminationTimer: NodeJS.Timeout | undefined
    let terminationRequested = false
    let resolved = false

    const child = spawn(command, {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const requestTermination = (): void => {
      if (terminationRequested) return
      terminationRequested = true

      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => child.kill())
      } else {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM')
          else child.kill('SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }

      // Wait for `close` so pipes are drained and process cleanup has a chance to finish. Keep a
      // bounded fallback for pathological child processes that never report closure.
      terminationTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
        finish(1)
      }, SHELL_TERMINATION_GRACE_MS)
      terminationTimer.unref?.()
    }

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
        requestTermination()
      }
    }

    const abortHandler = (): void => {
      requestTermination()
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
      if (terminationTimer) {
        clearTimeout(terminationTimer)
        terminationTimer = undefined
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
        statusText = `Command timed out after ${SHELL_FALLBACK_TIMEOUT_MS}ms and was terminated.`
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
      requestTermination()
    }, SHELL_FALLBACK_TIMEOUT_MS)

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
