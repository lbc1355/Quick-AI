import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type {
  BackgroundJobInfo,
  BackgroundShellCompletion,
  BackgroundShellJobMetadata,
  SessionResource,
  SessionResourceChunk,
  ToolArgs
} from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { assertCommandNotDangerous } from '../agent/commandSafety'
import {
  cancelBackgroundJob,
  clearBackgroundJobsForTests,
  getBackgroundJob,
  getBackgroundJobForSession,
  listBackgroundJobs,
  startBackgroundJob,
  updateBackgroundJob
} from '../agent/backgroundJobManager'
import { projectToolOutputHeadTail } from '../agent/toolOutputResource'
import { getResourceId, saveResourceChunk } from '../resourceCache'
import { createToolResult } from './result'
import { decodeShellOutputForDisplay, getShellFallbackEncoding } from './shellEncoding'
import type { AgentHostActions, ToolExecutionContext, ToolExecutionResult } from './types'
import { getWorkspaceRoot } from './helpers'

interface LiveBackgroundShellRun {
  id: string
  command: string
  cwd: string
  child?: ChildProcess
  pid?: number
  createdAt: number
  finishedAt?: number
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  error?: string
  stopRequested?: boolean
  output: string
  headOutput: string
  outputBaseOffset: number
  totalOutputChars: number
  totalOutputLines: number
  fallbackEncoding: string
  persistTimer?: NodeJS.Timeout
  resourceId?: string
  resourceWriteOffset: number
  resourceWriteChain: Promise<void>
  resource?: SessionResource
  resourceError?: string
}

const BACKGROUND_SHELL_MAX_BUFFER_CHARS = 10 * 1024 * 1024
const BACKGROUND_SHELL_HEAD_CHARS = 4_000
const SHELL_RESOURCE_THRESHOLD_CHARS = 16_000
const SHELL_RESOURCE_CHUNK_CHARS = 16_000
const COMPLETION_OUTPUT_PREVIEW_CHARS = 8_000
const OUTPUT_PERSIST_INTERVAL_MS = 250
const DEFAULT_READ_CHARS = 16_000
const MAX_READ_CHARS = 64_000
const DEFAULT_START_WAIT_MS = 500
const MAX_START_WAIT_MS = 5_000
const STOP_WAIT_MS = 2_000

/** Only live OS handles stay in memory; lifecycle state and logs live in BackgroundJobInfo. */
const liveRuns = new Map<string, LiveBackgroundShellRun>()

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

const shellMetadata = (run: LiveBackgroundShellRun): BackgroundShellJobMetadata => ({
  command: run.command,
  cwd: run.cwd,
  ...(run.pid !== undefined ? { pid: run.pid } : {}),
  ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
  ...(run.signal !== undefined ? { signal: run.signal } : {}),
  ...(run.resource ? { resourceId: run.resource.id } : {}),
  outputBaseOffset: run.outputBaseOffset,
  totalOutputChars: run.totalOutputChars,
  totalOutputLines: run.totalOutputChars > 0 ? run.totalOutputLines : 0
})

const buildLargeOutputProjection = (run: LiveBackgroundShellRun): string => {
  const retained = run.output
  const preview = projectToolOutputHeadTail(retained, COMPLETION_OUTPUT_PREVIEW_CHARS)
  const head = run.outputBaseOffset > 0 ? run.headOutput : preview.head
  const resourceId = run.resource?.id
  return [
    'Background shell output exceeded the inline limit.',
    resourceId ? `Resource ID: ${resourceId}` : 'Resource cache write is still pending.',
    `Total chars: ${run.totalOutputChars}`,
    `Total lines: ${run.totalOutputLines}`,
    run.outputBaseOffset > 0
      ? `Cached rolling window starts at character ${run.outputBaseOffset}.`
      : `Head offset: 0-${preview.headEndOffset}`,
    `Tail offset: ${run.outputBaseOffset + preview.tailStartOffset}-${run.totalOutputChars}`,
    resourceId ? `Search: search_cached_resource {"resourceId":"${resourceId}","query":"..."}` : '',
    resourceId
      ? `Read lines: read_cached_resource {"resourceId":"${resourceId}","lineStart":1,"lineEnd":200}`
      : '',
    resourceId
      ? `Read tail: read_cached_resource {"resourceId":"${resourceId}","tailLines":100}`
      : '',
    run.resourceError ? `Resource cache warning: ${run.resourceError}` : '',
    '',
    'Head preview:',
    head,
    '',
    'Tail preview:',
    preview.tail
  ]
    .filter(Boolean)
    .join('\n')
}

const outputForPersistence = (run: LiveBackgroundShellRun): string =>
  run.totalOutputChars > SHELL_RESOURCE_THRESHOLD_CHARS
    ? buildLargeOutputProjection(run)
    : run.output

const persistRun = (run: LiveBackgroundShellRun): void => {
  if (run.persistTimer) {
    clearTimeout(run.persistTimer)
    run.persistTimer = undefined
  }
  updateBackgroundJob(run.id, {
    metadata: shellMetadata(run),
    output: outputForPersistence(run),
    ...(run.error ? { error: run.error } : {})
  })
}

const schedulePersistRun = (run: LiveBackgroundShellRun): void => {
  if (run.persistTimer) return
  run.persistTimer = setTimeout(() => persistRun(run), OUTPUT_PERSIST_INTERVAL_MS)
  run.persistTimer.unref()
}

const resourceSource = (run: LiveBackgroundShellRun): string => `shell-output://${run.id}`

const createResourceChunk = (
  run: LiveBackgroundShellRun,
  text: string,
  offset: number,
  endOffset: number
): SessionResourceChunk => ({
  id: `shell-output-${run.id}-${offset}-${endOffset}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
  offset,
  endOffset,
  text,
  summary: text.slice(0, 160) + (text.length > 160 ? '...' : ''),
  createdAt: Date.now()
})

function queueResourceWrites(run: LiveBackgroundShellRun, force = false): void {
  if (!force && run.totalOutputChars <= SHELL_RESOURCE_THRESHOLD_CHARS) return
  if (!run.resourceId) run.resourceId = getResourceId(resourceSource(run))
  const resourceId = run.resourceId

  const targetOffset = force
    ? run.totalOutputChars
    : Math.floor(run.totalOutputChars / SHELL_RESOURCE_CHUNK_CHARS) * SHELL_RESOURCE_CHUNK_CHARS
  if (run.resourceWriteOffset < run.outputBaseOffset) {
    run.resourceWriteOffset = run.outputBaseOffset
  }

  while (run.resourceWriteOffset < targetOffset) {
    const offset = run.resourceWriteOffset
    const endOffset = Math.min(targetOffset, offset + SHELL_RESOURCE_CHUNK_CHARS)
    const text = run.output.slice(offset - run.outputBaseOffset, endOffset - run.outputBaseOffset)
    if (!text) break
    const actualEndOffset = offset + text.length
    const totalCharsAtWrite = run.totalOutputChars
    const chunk = createResourceChunk(run, text, offset, actualEndOffset)
    run.resourceWriteOffset = actualEndOffset
    run.resourceWriteChain = run.resourceWriteChain
      .then(async () => {
        run.resource = await saveResourceChunk(
          resourceId,
          'terminal',
          resourceSource(run),
          `Shell output: ${run.command.length > 80 ? `${run.command.slice(0, 77)}...` : run.command}`,
          totalCharsAtWrite,
          actualEndOffset < totalCharsAtWrite ? actualEndOffset : undefined,
          chunk
        )
        run.resourceError = undefined
        schedulePersistRun(run)
      })
      .catch((error: unknown) => {
        run.resourceError = error instanceof Error ? error.message : String(error)
        schedulePersistRun(run)
      })
  }
}

const flushResourceWrites = async (run: LiveBackgroundShellRun): Promise<void> => {
  if (run.totalOutputChars <= SHELL_RESOURCE_THRESHOLD_CHARS) return
  queueResourceWrites(run, true)
  await run.resourceWriteChain
}

const appendBoundedOutput = (run: LiveBackgroundShellRun, text: string): void => {
  if (!text) return
  if (run.headOutput.length < BACKGROUND_SHELL_HEAD_CHARS) {
    run.headOutput += text.slice(0, BACKGROUND_SHELL_HEAD_CHARS - run.headOutput.length)
  }
  run.output += text
  run.totalOutputChars += text.length
  run.totalOutputLines += (text.match(/\n/g) || []).length

  if (run.output.length > BACKGROUND_SHELL_MAX_BUFFER_CHARS) {
    const overflow = run.output.length - BACKGROUND_SHELL_MAX_BUFFER_CHARS
    run.output = run.output.slice(overflow)
    run.outputBaseOffset += overflow
  }
  queueResourceWrites(run)
  schedulePersistRun(run)
}

const labelStderr = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => (line ? `[stderr] ${line}` : line))
    .join('\n')

const appendOutputChunk = (
  run: LiveBackgroundShellRun,
  stream: 'stdout' | 'stderr',
  chunk: Buffer
): void => {
  const decoded = decodeShellOutputForDisplay(chunk, run.fallbackEncoding)
  appendBoundedOutput(run, stream === 'stderr' ? labelStderr(decoded) : decoded)
}

const getShellJobOrThrow = (processId: unknown, ctx?: ToolExecutionContext): BackgroundJobInfo => {
  if (typeof processId !== 'string' || !processId.trim()) {
    throw new Error('Missing or invalid processId parameter')
  }
  const id = processId.trim()
  const live = liveRuns.get(id)
  if (live) persistRun(live)
  const sessionId = ctx?.reqId ? getRun(ctx.reqId)?.sessionId : undefined
  const job = getBackgroundJobForSession(id, sessionId)
  if (!job || job.type !== 'shell') {
    throw new Error(`No background shell process found for processId "${id}".`)
  }
  return job
}

const getShellMetadata = (job: BackgroundJobInfo): Partial<BackgroundShellJobMetadata> =>
  (job.metadata || {}) as Partial<BackgroundShellJobMetadata>

const formatDuration = (job: BackgroundJobInfo, now = Date.now()): number =>
  (job.completedAt || now) - job.createdAt

const formatRunHeader = (job: BackgroundJobInfo): string => {
  const metadata = getShellMetadata(job)
  const lines = [
    `Background ID: ${job.id}`,
    metadata.pid !== undefined ? `OS PID: ${metadata.pid}` : '',
    `Status: ${job.status}`,
    metadata.exitCode !== undefined ? `Exit Code: ${metadata.exitCode}` : '',
    metadata.signal ? `Signal: ${metadata.signal}` : '',
    metadata.cwd ? `Cwd: ${metadata.cwd}` : '',
    `Duration: ${formatDuration(job)}ms`,
    `Output Chars: ${metadata.totalOutputChars || 0}`,
    `Command: ${metadata.command || job.description || job.title}`,
    job.error ? `Error: ${job.error}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

const readJobOutput = (
  job: BackgroundJobInfo,
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
  const metadata = getShellMetadata(job)
  const output = job.output || ''
  const maxChars = clampNumber(maxCharsArg, DEFAULT_READ_CHARS, 1_000, MAX_READ_CHARS)
  const availableStart = Number(metadata.outputBaseOffset) || 0
  const availableEnd = availableStart + output.length
  const requestedOffset =
    offsetArg === undefined || offsetArg === null
      ? Math.max(availableStart, availableEnd - maxChars)
      : clampNumber(offsetArg, availableStart, 0, Number.MAX_SAFE_INTEGER)
  const startOffset = Math.max(requestedOffset, availableStart)
  const endOffset = Math.min(availableEnd, startOffset + maxChars)
  const text = output.slice(startOffset - availableStart, endOffset - availableStart)
  const nextOffset = endOffset < availableEnd ? endOffset : undefined
  const warning =
    requestedOffset < availableStart
      ? `Requested offset ${requestedOffset} has been evicted; returning from ${availableStart}.`
      : undefined

  return { text, requestedOffset, startOffset, endOffset, nextOffset, warning }
}

const formatOutputWindow = (
  job: BackgroundJobInfo,
  offsetArg: unknown,
  maxCharsArg: unknown
): string => {
  const outputWindow = readJobOutput(job, offsetArg, maxCharsArg)
  const nextOffsetLine =
    outputWindow.nextOffset !== undefined
      ? `Next Offset: ${outputWindow.nextOffset}`
      : 'Next Offset: none (current end of buffered output)'
  const warningLine = outputWindow.warning ? `Warning: ${outputWindow.warning}` : ''
  return [
    formatRunHeader(job),
    `Returned Offset: ${outputWindow.startOffset}-${outputWindow.endOffset}`,
    `Requested Offset: ${outputWindow.requestedOffset}`,
    nextOffsetLine,
    warningLine,
    '',
    'Output:',
    outputWindow.text || '(no output captured yet)'
  ]
    .filter((line) => line !== '')
    .join('\n')
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const waitForProcessClose = async (
  run: LiveBackgroundShellRun,
  timeoutMs: number
): Promise<void> => {
  const child = run.child
  if (!child || run.finishedAt) return
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      child.off('close', done)
      child.off('error', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    child.once('close', done)
    child.once('error', done)
  })
}

const stopProcessTree = async (run: LiveBackgroundShellRun): Promise<void> => {
  run.stopRequested = true
  if (!run.child) return
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
        if (code !== 0) run.child?.kill()
        finish()
      })
      killer.once('error', () => {
        run.child?.kill()
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

const publishCompletion = (
  run: LiveBackgroundShellRun,
  status: BackgroundShellCompletion['status'],
  host: AgentHostActions | undefined,
  parentToolCallId?: string
): void => {
  const completion: BackgroundShellCompletion = {
    jobId: run.id,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    command: run.command,
    status,
    ...(run.output ? { output: outputForPersistence(run) } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    ...(run.signal !== undefined ? { signal: run.signal } : {}),
    durationMs: Math.max(0, (run.finishedAt || Date.now()) - run.createdAt),
    ...(run.resource ? { resourceId: run.resource.id, resource: run.resource } : {}),
    totalOutputChars: run.totalOutputChars,
    totalOutputLines: run.totalOutputChars > 0 ? run.totalOutputLines : 0,
    outputTruncated: run.totalOutputChars > SHELL_RESOURCE_THRESHOLD_CHARS
  }
  const timer = setTimeout(() => host?.publishBackgroundShellCompletion?.(completion), 0)
  timer.unref()
}

const runBackgroundShellProcess = async (
  run: LiveBackgroundShellRun,
  signal: AbortSignal,
  host: AgentHostActions | undefined,
  parentToolCallId?: string
): Promise<{ status: BackgroundShellCompletion['status']; error?: string }> => {
  try {
    run.child = spawn(run.command, {
      cwd: run.cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    run.pid = run.child.pid
    persistRun(run)
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error)
    run.finishedAt = Date.now()
    persistRun(run)
    publishCompletion(run, 'failed', host, parentToolCallId)
    liveRuns.delete(run.id)
    return { status: 'failed', error: run.error }
  }

  run.child.stdout?.on('data', (chunk: Buffer) => appendOutputChunk(run, 'stdout', chunk))
  run.child.stderr?.on('data', (chunk: Buffer) => appendOutputChunk(run, 'stderr', chunk))

  const outcome = await new Promise<{
    status: BackgroundShellCompletion['status']
    error?: string
  }>((resolve) => {
    let settled = false
    const finish = (status: BackgroundShellCompletion['status'], error?: string): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      resolve({ status, ...(error ? { error } : {}) })
    }
    const handleAbort = (): void => {
      void stopProcessTree(run)
    }

    run.child?.once('error', (error) => {
      run.error = error.message
    })
    run.child?.once('close', (code, closeSignal) => {
      run.exitCode = code
      run.signal = closeSignal
      if (signal.aborted || run.stopRequested) {
        finish('cancelled')
      } else if (code === 0) {
        finish('completed')
      } else {
        run.error ||= `Command exited with code ${code ?? 'unknown'}.`
        finish('failed', run.error)
      }
    })

    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
  })

  run.finishedAt = Date.now()
  if (outcome.error) run.error = outcome.error
  await flushResourceWrites(run)
  persistRun(run)
  publishCompletion(run, outcome.status, host, parentToolCallId)
  liveRuns.delete(run.id)
  return outcome
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
  if (!command) throw new Error('Missing or invalid command parameter')
  if (ctx.signal?.aborted) throw new Error('Agent execution aborted by user.')
  // Same defense-in-depth as the foreground executor: destructive commands never spawn.
  assertCommandNotDangerous(command)

  const cwd = getBackgroundShellRoot(ctx)
  const runCtx = ctx.reqId ? getRun(ctx.reqId) : undefined
  const run: LiveBackgroundShellRun = {
    id: createRunId(),
    command,
    cwd,
    createdAt: Date.now(),
    output: '',
    headOutput: '',
    outputBaseOffset: 0,
    totalOutputChars: 0,
    totalOutputLines: 1,
    fallbackEncoding: getShellFallbackEncoding(),
    resourceWriteOffset: 0,
    resourceWriteChain: Promise.resolve()
  }
  liveRuns.set(run.id, run)

  startBackgroundJob({
    id: run.id,
    type: 'shell',
    title: command.length > 80 ? `${command.slice(0, 77)}...` : command,
    description: command,
    sessionId: runCtx?.sessionId,
    metadata: shellMetadata(run),
    output: '',
    run: (signal) => runBackgroundShellProcess(run, signal, ctx.host, ctx.callId)
  })

  const waitMs = clampNumber(args.waitMs, DEFAULT_START_WAIT_MS, 0, MAX_START_WAIT_MS)
  if (waitMs > 0) await wait(waitMs)
  if (liveRuns.has(run.id)) persistRun(run)
  const job = getBackgroundJob(run.id)
  if (!job) throw new Error(`Background shell job ${run.id} was not created.`)

  const details = [
    'Background shell task started and persisted.',
    formatOutputWindow(job, undefined, args.maxChars),
    '',
    'The Agent will be notified automatically when the command finishes; do not poll it.',
    `Use shell_background_read with {"processId":"${run.id}"} only when current output is needed.`,
    `Use shell_background_stop with {"processId":"${run.id}"} to stop the process.`
  ].join('\n')

  return createBackgroundShellResult({
    title: `Start Background Command: ${command.length > 50 ? `${command.slice(0, 47)}...` : command}`,
    summary: `Started persistent background shell task ${run.id}`,
    details
  })
}

export async function executeBackgroundShellRead(
  args: ToolArgs,
  ctx?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const job = getShellJobOrThrow(args.processId, ctx)
  const metadata = getShellMetadata(job)
  const details = formatOutputWindow(job, args.offset, args.maxChars)
  return createBackgroundShellResult({
    title: `Read Background Shell: ${job.id}`,
    summary: `${job.status} - ${metadata.totalOutputChars || 0} output chars`,
    details
  })
}

export async function executeBackgroundShellStop(
  args: ToolArgs,
  ctx?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let job = getShellJobOrThrow(args.processId, ctx)
  const live = liveRuns.get(job.id)
  if (job.status === 'running') {
    cancelBackgroundJob(job.id)
    if (live) await waitForProcessClose(live, STOP_WAIT_MS)
    job = getShellJobOrThrow(job.id, ctx)
  }

  const details = [
    job.status === 'running'
      ? 'Stop was requested, but the process is still running.'
      : 'Background shell task stopped or already finished.',
    formatOutputWindow(job, args.offset, args.maxChars)
  ].join('\n')

  return createBackgroundShellResult({
    title: `Stop Background Shell: ${job.id}`,
    summary: `${job.id} status: ${job.status}`,
    details
  })
}

export async function executeBackgroundShellList(
  _args?: ToolArgs,
  ctx?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  for (const run of liveRuns.values()) persistRun(run)
  const runCtx = ctx?.reqId ? getRun(ctx.reqId) : undefined
  const jobs = listBackgroundJobs(runCtx?.sessionId).filter(
    (job) => job.type === 'shell' && job.sessionId === runCtx?.sessionId
  )
  const details =
    jobs.length === 0
      ? 'No background shell tasks.'
      : [
          'Background shell tasks:',
          ...jobs.map((job) => {
            const metadata = getShellMetadata(job)
            return `- ${job.id} - ${job.status} - pid ${metadata.pid ?? 'n/a'} - ${formatDuration(job)}ms - ${metadata.totalOutputChars || 0} chars - ${metadata.command || job.description || job.title}`
          })
        ].join('\n')

  return createBackgroundShellResult({
    title: 'List Background Shell Tasks',
    summary: `${jobs.length} background shell task(s)`,
    details
  })
}

export async function clearBackgroundShellProcessesForTests(): Promise<void> {
  const activeRuns = Array.from(liveRuns.values())
  for (const run of activeRuns) cancelBackgroundJob(run.id)
  await Promise.all(activeRuns.map((run) => waitForProcessClose(run, STOP_WAIT_MS)))
  for (const run of activeRuns) {
    if (run.persistTimer) clearTimeout(run.persistTimer)
  }
  liveRuns.clear()
  clearBackgroundJobsForTests()
}
