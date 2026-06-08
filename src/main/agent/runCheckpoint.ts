import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { ChatCompletionMessage, ToolArgs } from '../../shared/types'

const CHECKPOINT_VERSION = 1

export interface AmbiguousAction {
  callId: string
  toolName: string
  args: ToolArgs
  reason: string
  timestamp: number
}

export interface RunCheckpoint {
  version: typeof CHECKPOINT_VERSION
  sessionId: string
  reqId: string
  updatedAt: number
  step: number
  messages: ChatCompletionMessage[]
  activeTools: string[]
  lastCompletedCallId?: string
  ambiguousActions?: AmbiguousAction[]
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function getRunCheckpointPath(sessionId: string, reqId: string): string {
  return join(
    app.getPath('userData'),
    'run_checkpoints',
    safeId(sessionId),
    `${safeId(reqId)}.json`
  )
}

export function getRunCheckpointDir(sessionId: string): string {
  return join(app.getPath('userData'), 'run_checkpoints', safeId(sessionId))
}

function cloneMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ChatCompletionMessage[]
}

export function saveRunCheckpoint(checkpoint: Omit<RunCheckpoint, 'version' | 'updatedAt'>): void {
  const path = getRunCheckpointPath(checkpoint.sessionId, checkpoint.reqId)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const body: RunCheckpoint = {
    ...checkpoint,
    version: CHECKPOINT_VERSION,
    updatedAt: Date.now(),
    messages: cloneMessages(checkpoint.messages)
  }
  writeFileSync(path, JSON.stringify(body), 'utf-8')
}

export function loadRunCheckpoint(sessionId: string, reqId: string): RunCheckpoint | undefined {
  const path = getRunCheckpointPath(sessionId, reqId)
  if (!existsSync(path)) return undefined

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RunCheckpoint
    if (parsed.version !== CHECKPOINT_VERSION || !Array.isArray(parsed.messages)) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export async function deleteRunCheckpoint(sessionId: string, reqId: string): Promise<void> {
  try {
    await fsp.unlink(getRunCheckpointPath(sessionId, reqId))
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      console.warn('Failed to delete run checkpoint:', e.message)
    }
  }
}

export async function deleteRunCheckpoints(sessionId: string): Promise<void> {
  try {
    rmSync(getRunCheckpointDir(sessionId), { recursive: true, force: true })
  } catch (err) {
    console.warn('Failed to delete run checkpoints:', (err as Error).message)
  }
}
