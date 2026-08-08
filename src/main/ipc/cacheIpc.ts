import { ipcMain } from 'electron'
import { ActionLog, getActionLogPath, deleteActionLog } from '../agent/actionLog'
import {
  deleteRunCheckpoint,
  deleteRunCheckpoints,
  copyRunCheckpointsForRuns
} from '../agent/runCheckpoint'
import {
  deleteRunManifest,
  deleteRunManifests,
  copyRunManifestsForRuns
} from '../agent/runManifest'
import { deleteResourceFile } from '../resourceCache'
import { clearSessionApprovals } from '../agent/AgentRunContext'
import { compactContextWithModel } from '../agent/contextCompactor'
import {
  copyAgentEventJournalsForRuns,
  deleteAgentEventJournal,
  deleteAgentEventJournals
} from '../agent/agentEventJournal'
import {
  applySessionFileTransition,
  previewAgentFileRevert,
  previewSessionFileTransition,
  revertAgentFileChanges
} from '../agent/agentFileSnapshot'

// The single in-flight compaction — only one session can compact at a time (guarded by the
// renderer's busy state). Kept so 'abort-compaction' can cancel it; cleared when the call settles.
let activeCompactionController: AbortController | null = null

export function registerCacheIpc(): void {
  ipcMain.handle('preview-agent-file-revert', (_event, sessionId: string, runId: string) =>
    previewAgentFileRevert(sessionId, runId)
  )
  ipcMain.handle('revert-agent-file-changes', (_event, input) => revertAgentFileChanges(input))
  ipcMain.handle('preview-session-file-transition', (_event, input) =>
    previewSessionFileTransition(input)
  )
  ipcMain.handle('apply-session-file-transition', (_event, input) =>
    applySessionFileTransition(input)
  )

  ipcMain.handle('clear-session-caches', async (_event, payload) => {
    const sessionIds: string[] = Array.isArray(payload?.sessionIds)
      ? payload.sessionIds.filter((id: unknown): id is string => typeof id === 'string')
      : []
    const resourceIds: string[] = Array.isArray(payload?.resourceIds)
      ? payload.resourceIds.filter((id: unknown): id is string => typeof id === 'string')
      : []

    const partialActions: Array<{ sessionId: string; runIds: string[] }> = Array.isArray(
      payload?.partialActions
    )
      ? payload.partialActions.filter(
          (e: unknown): e is { sessionId: string; runIds: string[] } =>
            !!e &&
            typeof (e as { sessionId?: unknown }).sessionId === 'string' &&
            Array.isArray((e as { runIds?: unknown }).runIds)
        )
      : []
    for (const entry of partialActions) {
      const runIds = entry.runIds.filter((id): id is string => typeof id === 'string')
      if (runIds.length === 0) continue
      try {
        new ActionLog(getActionLogPath(entry.sessionId)).deleteByRunIds(runIds)
        await Promise.all(runIds.map((runId) => deleteRunCheckpoint(entry.sessionId, runId)))
        await Promise.all(runIds.map((runId) => deleteRunManifest(entry.sessionId, runId)))
        await Promise.all(runIds.map((runId) => deleteAgentEventJournal(entry.sessionId, runId)))
      } catch (err) {
        console.warn('clear-session-caches: partial action delete failed:', (err as Error).message)
      }
    }

    for (const id of sessionIds) {
      clearSessionApprovals(id)
    }

    const results = await Promise.allSettled([
      ...sessionIds.map((id) => deleteActionLog(id)),
      ...sessionIds.map((id) => deleteRunCheckpoints(id)),
      ...sessionIds.map((id) => deleteRunManifests(id)),
      ...sessionIds.map((id) => deleteAgentEventJournals(id)),
      ...resourceIds.map((id) => deleteResourceFile(id))
    ])
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('clear-session-caches: a cache delete failed:', r.reason)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('fork-session-caches', async (_event, payload) => {
    const sourceSessionId =
      typeof payload?.sourceSessionId === 'string' ? payload.sourceSessionId : ''
    const targetSessionId =
      typeof payload?.targetSessionId === 'string' ? payload.targetSessionId : ''
    const runIds: string[] = Array.isArray(payload?.runIds)
      ? payload.runIds.filter((id: unknown): id is string => typeof id === 'string')
      : []

    if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) {
      return { ok: true, actions: 0, checkpoints: 0, manifests: 0, events: 0 }
    }

    try {
      const sourceLog = new ActionLog(getActionLogPath(sourceSessionId))
      const targetLog = new ActionLog(getActionLogPath(targetSessionId))
      const actions = sourceLog.copyByRunIdsTo(targetLog, runIds)
      const checkpoints = copyRunCheckpointsForRuns(sourceSessionId, targetSessionId, runIds)
      const manifests = copyRunManifestsForRuns(sourceSessionId, targetSessionId, runIds)
      const events = copyAgentEventJournalsForRuns(sourceSessionId, targetSessionId, runIds)
      return { ok: true, actions, checkpoints, manifests, events }
    } catch (err) {
      console.warn('fork-session-caches failed:', (err as Error).message)
      return { ok: false, actions: 0, checkpoints: 0, manifests: 0, events: 0 }
    }
  })

  ipcMain.handle('compact-context', async (_event, payload) => {
    const controller = new AbortController()
    activeCompactionController = controller
    try {
      return await compactContextWithModel(payload, { signal: controller.signal })
    } finally {
      if (activeCompactionController === controller) activeCompactionController = null
    }
  })

  ipcMain.on('abort-compaction', () => {
    activeCompactionController?.abort()
  })
}
