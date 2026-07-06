import { ChildProcess, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { createToolResult } from './result'
import { decodeShellOutputForDisplay, getShellFallbackEncoding } from './shellEncoding'
import { ToolExecutionContext, ToolExecutionResult } from './types'
import { getWorkspaceRoot } from './helpers'

type BackgroundShellStatus = 'running' | 'exited' | 'error' | 'stopped'

interface BackgroundShellRun {
  id: string
  command: string
  cwd: string
  child: ChildProcess
  pid?: number
  status: BackgroundShellStatus
  createdAt: number
  updatedAt: number
  finishedAt?: number
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  error?: string
  stopRequested?: boolean
  output: string
  outputBaseOffset: number
  totalOutputChars: number
  fallbackEncoding: string
}

const BACKGROUND_SHELL_MAX_BUFFER_CHARS = 512 * 1024
const DEFAULT_READ_CHARS = 16000
const MAX_READ_CHARS = 64000
const DEFAULT_START_WAIT_MS = 500
const MAX_START_WAIT_MS = 5000
const STOP_WAIT_MS = 2000

const runs = new Map<string, BackgroundShellRun>()

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.floor(num)))
}

const getBackgroundShellRoot = (ctx: ToolExecutionContext): string => {
  const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
  return runCtx?.projectRoot || getWorkspaceRoot()
}

const createRunId = (): string => `bg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`

const markRunUpdated = (run: BackgroundShellRun): void => {
  run.updatedAt = Date.now()
}

const appendBoundedOutput = (run: BackgroundShellRun, text: string): void => {
  if (!text) return
  run.output += text
  run.totalOutputChars += text.length

  if (run.output.length > BACKGROUND_SHELL_MAX_BUFFER_CHARS) {
    const overflow = run.output.length - BACKGROUND_SHELL_MAX_BUFFER_CHARS
    run.output = run.output.slice(overflow)
    run.outputBaseOffset += overflow
  }

  markRunUpdated(run)
}

const labelStderr = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => (line ? `[stderr] ${line}` : line))
    .join('\n')

const appendOutputChunk = (
  run: BackgroundShellRun,
  stream: 'stdout' | 'stderr',
  chunk: Buffer
): void => {
  const decoded = decodeShellOutputForDisplay(chunk, run.fallbackEncoding)
  appendBoundedOutput(run, stream === 'stderr' ? labelStderr(decoded) : decoded)
}

const formatDuration = (run: BackgroundShellRun, now = Date.now()): number =>
  (run.finishedAt || now) - run.createdAt

const getRunOrThrow = (processId: unknown): BackgroundShellRun => {
  if (typeof processId !== 'string' || !processId.trim()) {
    throw new Error('Missing or invalid processId parameter')
  }
  const run = runs.get(processId.trim())
  if (!run) {
    throw new Error(`No background shell process found for processId "${processId}".`)
  }
  return run
}

const formatRunHeader = (run: BackgroundShellRun): string => {
  const lines = [
    `Background ID: ${run.id}`,
    run.pid !== undefined ? `OS PID: ${run.pid}` : '',
    `Status: ${run.status}`,
    run.exitCode !== undefined ? `Exit Code: ${run.exitCode}` : '',
    run.signal ? `Signal: ${run.signal}` : '',
    `Cwd: ${run.cwd}`,
    `Duration: ${formatDuration(run)}ms`,
    `Output Chars: ${run.totalOutputChars}`,
    `Command: ${run.command}`,
    run.error ? `Error: ${run.error}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

const readRunOutput = (
  run: BackgroundShellRun,
  offsetArg: unknown,
  maxCharsArg: unknown
): {
  text: string
  requestedOffset: number
  startOffset: number
  endOffset: number
  nextOffset?: number
  warning?: string
} => {
  const maxChars = clampNumber(maxCharsArg, DEFAULT_READ_CHARS, 1000, MAX_READ_CHARS)
  const availableStart = run.outputBaseOffset
  const availableEnd = run.outputBaseOffset + run.output.length
  const requestedOffset =
    offsetArg === undefined || offsetArg === null
      ? Math.max(availableStart, availableEnd - maxChars)
      : clampNumber(offsetArg, availableStart, 0, Number.MAX_SAFE_INTEGER)
  const startOffset = Math.max(requestedOffset, availableStart)
  const endOffset = Math.min(availableEnd, startOffset + maxChars)
  const text = run.output.slice(startOffset - availableStart, endOffset - availableStart)
  const nextOffset = endOffset < availableEnd ? endOffset : undefined
  const warning =
    requestedOffset < availableStart
      ? `Requested offset ${requestedOffset} has been evicted; returning from ${availableStart}.`
      : undefined

  return { text, requestedOffset, startOffset, endOffset, nextOffset, warning }
}

const formatOutputWindow = (
  run: BackgroundShellRun,
  offsetArg: unknown,
  maxCharsArg: unknown
): string => {
  const window = readRunOutput(run, offsetArg, maxCharsArg)
  const nextOffsetLine =
    window.nextOffset !== undefined
      ? `Next Offset: ${window.nextOffset}`
      : 'Next Offset: none (current end of buffered output)'
  const warningLine = window.warning ? `Warning: ${window.warning}` : ''
  return [
    formatRunHeader(run),
    `Returned Offset: ${window.startOffset}-${window.endOffset}`,
    `Requested Offset: ${window.requestedOffset}`,
    nextOffsetLine,
    warningLine,
    '',
    'Output:',
    window.text || '(no output captured yet)'
  ]
    .filter((line) => line !== '')
    .join('\n')
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function startBackgroundShell(command: string, cwd: string): BackgroundShellRun {
  const child = spawn(command, {
    cwd,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const run: BackgroundShellRun = {
    id: createRunId(),
    command,
    cwd,
    child,
    pid: child.pid,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    output: '',
    outputBaseOffset: 0,
    totalOutputChars: 0,
    fallbackEncoding: getShellFallbackEncoding()
  }

  runs.set(run.id, run)

  child.stdout?.on('data', (chunk: Buffer) => appendOutputChunk(run, 'stdout', chunk))
  child.stderr?.on('data', (chunk: Buffer) => appendOutputChunk(run, 'stderr', chunk))
  child.on('error', (error) => {
    run.status = 'error'
    run.error = error.message
    run.finishedAt = Date.now()
    markRunUpdated(run)
  })
  child.on('close', (code, signal) => {
    run.status = run.stopRequested ? 'stopped' : run.status === 'error' ? 'error' : 'exited'
    run.exitCode = code
    run.signal = signal
    run.finishedAt = Date.now()
    markRunUpdated(run)
  })

  return run
}

const waitForProcessClose = async (run: BackgroundShellRun, timeoutMs: number): Promise<void> => {
  if (run.status !== 'running') return
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      run.child.off('close', done)
      run.child.off('error', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    run.child.once('close', done)
    run.child.once('error', done)
  })
}

const stopProcessTree = async (run: BackgroundShellRun): Promise<void> => {
  run.stopRequested = true
  if (!run.pid) {
    run.child.kill()
    return
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(run.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      let resolved = false
      const finish = (): void => {
        if (resolved) return
        resolved = true
        resolve()
      }
      killer.once('close', (code) => {
        if (code !== 0) {
          run.child.kill()
        }
        finish()
      })
      killer.once('error', () => {
        run.child.kill()
        finish()
      })
    })
    return
  }

  try {
    process.kill(-run.pid, 'SIGTERM')
  } catch {
    run.child.kill('SIGTERM')
  }
}

const createBackgroundShellResult = (options: {
  title: string
  summary: string
  details: string
}): ToolExecutionResult =>
  createToolResult({
    resultForModel: options.details,
    title: options.title,
    summary: options.summary,
    details: options.details
  })

export async function executeBackgroundShellStart(
  args: ToolArgs,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  if (!command) {
    throw new Error('Missing or invalid command parameter')
  }
  if (ctx.signal?.aborted) {
    throw new Error('Agent execution aborted by user.')
  }

  const cwd = getBackgroundShellRoot(ctx)
  const run = startBackgroundShell(command, cwd)
  const waitMs = clampNumber(args.waitMs, DEFAULT_START_WAIT_MS, 0, MAX_START_WAIT_MS)
  if (waitMs > 0) {
    await wait(waitMs)
  }

  const details = [
    'Background shell process started.',
    formatOutputWindow(run, undefined, args.maxChars),
    '',
    `Use shell_background_read with {"processId":"${run.id}"} to read later output.`,
    `Use shell_background_stop with {"processId":"${run.id}"} to stop the process.`
  ].join('\n')

  return createBackgroundShellResult({
    title: `Start Background Command: ${command.length > 50 ? `${command.slice(0, 47)}...` : command}`,
    summary: `Started background shell process ${run.id}`,
    details
  })
}

export async function executeBackgroundShellRead(args: ToolArgs): Promise<ToolExecutionResult> {
  const run = getRunOrThrow(args.processId)
  const details = formatOutputWindow(run, args.offset, args.maxChars)
  return createBackgroundShellResult({
    title: `Read Background Shell: ${run.id}`,
    summary: `${run.status} - ${run.totalOutputChars} output chars`,
    details
  })
}

export async function executeBackgroundShellStop(args: ToolArgs): Promise<ToolExecutionResult> {
  const run = getRunOrThrow(args.processId)
  if (run.status === 'running') {
    await stopProcessTree(run)
    await waitForProcessClose(run, STOP_WAIT_MS)
  }

  const details = [
    run.status === 'running'
      ? 'Stop was requested, but the process is still running.'
      : 'Background shell process stopped or already finished.',
    formatOutputWindow(run, args.offset, args.maxChars)
  ].join('\n')

  return createBackgroundShellResult({
    title: `Stop Background Shell: ${run.id}`,
    summary: `${run.id} status: ${run.status}`,
    details
  })
}

export async function executeBackgroundShellList(): Promise<ToolExecutionResult> {
  const allRuns = Array.from(runs.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  const details =
    allRuns.length === 0
      ? 'No background shell processes.'
      : [
          'Background shell processes:',
          ...allRuns.map(
            (run) =>
              `- ${run.id} - ${run.status} - pid ${run.pid ?? 'n/a'} - ${formatDuration(run)}ms - ${run.totalOutputChars} chars - ${run.command}`
          )
        ].join('\n')

  return createBackgroundShellResult({
    title: 'List Background Shell Processes',
    summary: `${allRuns.length} background shell process(es)`,
    details
  })
}

export async function clearBackgroundShellProcessesForTests(): Promise<void> {
  const activeRuns = Array.from(runs.values()).filter((run) => run.status === 'running')
  await Promise.all(
    activeRuns.map(async (run) => {
      await stopProcessTree(run)
      await waitForProcessClose(run, STOP_WAIT_MS)
    })
  )
  runs.clear()
}

export interface BackgroundShellInfo {
  id: string
  command: string
  status: BackgroundShellStatus
  pid?: number
  createdAt: number
  totalOutputChars: number
}

export function getBackgroundShells(): BackgroundShellInfo[] {
  return Array.from(runs.values()).map((run) => ({
    id: run.id,
    command: run.command,
    status: run.status,
    pid: run.pid,
    createdAt: run.createdAt,
    totalOutputChars: run.totalOutputChars
  }))
}

export function readBackgroundShellLog(id: string): { output: string; status: string; totalOutputChars: number } {
  const run = runs.get(id)
  if (!run) throw new Error(`Process ${id} not found`)
  return {
    output: run.output,
    status: run.status,
    totalOutputChars: run.totalOutputChars
  }
}

export async function stopBackgroundShell(id: string): Promise<void> {
  const run = runs.get(id)
  if (!run) throw new Error(`Process ${id} not found`)
  if (run.status === 'running') {
    await stopProcessTree(run)
    await waitForProcessClose(run, STOP_WAIT_MS)
  }
}
