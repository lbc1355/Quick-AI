import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { AgentFileChange, ReasoningPreference, ToolArgs } from '../../shared/types'

const MANIFEST_VERSION = 1

export type RunManifestStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'max_steps'
  | 'safety_stop'
export type SideEffectKind =
  | 'read'
  | 'cache'
  | 'file_write'
  | 'shell'
  | 'memory'
  | 'external'
  | 'system'
export type SideEffectReversibility =
  | 'none'
  | 'metadata_only'
  | 'reversible'
  | 'ambiguous'
  | 'irreversible'

export interface SideEffectEntry {
  actionId: string
  runId: string
  toolName: string
  kind: SideEffectKind
  reversibility: SideEffectReversibility
  status: 'success' | 'error' | 'denied' | 'blocked' | 'ambiguous'
  summary: string
  args?: ToolArgs
  command?: string
  filesTouched?: string[]
  createdAt: number
}

export interface AgentRunManifest {
  version: typeof MANIFEST_VERSION
  runId: string
  sessionId: string
  sourceMessageId?: string
  assistantMessageId?: string
  parentRunId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  status: RunManifestStatus
  actionCallIds: string[]
  resourceIds: string[]
  checkpointIds: string[]
  createdMessageIds: string[]
  sideEffects: SideEffectEntry[]
  fileSnapshot?: {
    projectRoot: string
    startTree: string
    endTree: string
    files: AgentFileChange[]
    completedAt: number
    revertedAt?: number
    restoredTree?: string
  }
  startedAt: number
  updatedAt: number
  completedAt?: number
  error?: string
  /** Thinking preference captured when the run started. */
  requestedReasoningPreference?: ReasoningPreference
  effectiveReasoningPreference?: ReasoningPreference
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function getRunManifestPath(sessionId: string, runId: string): string {
  return join(app.getPath('userData'), 'run_manifests', safeId(sessionId), `${safeId(runId)}.json`)
}

export function getRunManifestDir(sessionId: string): string {
  return join(app.getPath('userData'), 'run_manifests', safeId(sessionId))
}

export function getRunManifestRoot(): string {
  return join(app.getPath('userData'), 'run_manifests')
}

export async function listRunManifests(): Promise<AgentRunManifest[]> {
  let sessionDirs: import('fs').Dirent[]
  try {
    sessionDirs = await fsp.readdir(getRunManifestRoot(), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const manifests: AgentRunManifest[] = []
  for (const sessionDir of sessionDirs) {
    if (!sessionDir.isDirectory()) continue
    const directory = join(getRunManifestRoot(), sessionDir.name)
    let files: import('fs').Dirent[]
    try {
      files = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(
          await fsp.readFile(join(directory, file.name), 'utf-8')
        ) as AgentRunManifest
        if (
          parsed.version === MANIFEST_VERSION &&
          typeof parsed.sessionId === 'string' &&
          typeof parsed.runId === 'string'
        ) {
          manifests.push(parsed)
        }
      } catch {
        // Ignore incomplete/corrupt manifests; their snapshot refs are reclaimed after grace time.
      }
    }
  }
  return manifests
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function saveManifest(manifest: AgentRunManifest): void {
  const path = getRunManifestPath(manifest.sessionId, manifest.runId)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, JSON.stringify({ ...manifest, updatedAt: Date.now() }), 'utf-8')
}

export function createRunManifest(
  input: Omit<
    AgentRunManifest,
    | 'version'
    | 'status'
    | 'actionCallIds'
    | 'resourceIds'
    | 'checkpointIds'
    | 'createdMessageIds'
    | 'sideEffects'
    | 'startedAt'
    | 'updatedAt'
  >
): AgentRunManifest {
  const now = Date.now()
  const manifest: AgentRunManifest = {
    ...input,
    version: MANIFEST_VERSION,
    status: 'running',
    actionCallIds: [],
    resourceIds: [],
    checkpointIds: [],
    createdMessageIds: uniq([input.sourceMessageId || '', input.assistantMessageId || '']),
    sideEffects: [],
    startedAt: now,
    updatedAt: now
  }
  saveManifest(manifest)
  return manifest
}

export function loadRunManifest(sessionId: string, runId: string): AgentRunManifest | undefined {
  const path = getRunManifestPath(sessionId, runId)
  if (!existsSync(path)) return undefined

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AgentRunManifest
    if (parsed.version !== MANIFEST_VERSION) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function copyRunManifestsForRuns(
  sourceSessionId: string,
  targetSessionId: string,
  runIds: string[]
): number {
  if (sourceSessionId === targetSessionId || runIds.length === 0) return 0

  let copied = 0
  for (const runId of runIds) {
    const manifest = loadRunManifest(sourceSessionId, runId)
    if (!manifest) continue
    saveManifest({
      ...manifest,
      sessionId: targetSessionId,
      updatedAt: Date.now()
    })
    copied += 1
  }
  return copied
}

export function updateRunManifest(
  sessionId: string,
  runId: string,
  updater: (manifest: AgentRunManifest) => AgentRunManifest
): void {
  const existing = loadRunManifest(sessionId, runId)
  if (!existing) return
  const next = updater(existing)
  saveManifest(next)
}

export function appendRunAction(
  sessionId: string,
  runId: string,
  callId: string,
  sideEffect?: SideEffectEntry
): void {
  updateRunManifest(sessionId, runId, (manifest) => ({
    ...manifest,
    actionCallIds: uniq([...manifest.actionCallIds, callId]),
    sideEffects: sideEffect ? [...manifest.sideEffects, sideEffect] : manifest.sideEffects
  }))
}

export function appendRunCheckpoint(sessionId: string, runId: string, checkpointId: string): void {
  updateRunManifest(sessionId, runId, (manifest) => ({
    ...manifest,
    checkpointIds: uniq([...manifest.checkpointIds, checkpointId])
  }))
}

export function finishRunManifest(
  sessionId: string,
  runId: string,
  status: RunManifestStatus,
  error?: string
): void {
  updateRunManifest(sessionId, runId, (manifest) => ({
    ...manifest,
    status,
    completedAt: Date.now(),
    error
  }))
}

export async function deleteRunManifest(sessionId: string, runId: string): Promise<void> {
  try {
    await fsp.unlink(getRunManifestPath(sessionId, runId))
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      console.warn('Failed to delete run manifest:', e.message)
    }
  }
}

export async function deleteRunManifests(sessionId: string): Promise<void> {
  try {
    rmSync(getRunManifestDir(sessionId), { recursive: true, force: true })
  } catch (err) {
    console.warn('Failed to delete run manifests:', (err as Error).message)
  }
}
