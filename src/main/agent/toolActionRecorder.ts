import { ToolArgs } from '../../shared/types'
import { ActionLog, ActionRecord } from './actionLog'
import { appendRunAction, updateRunManifest } from './runManifest'
import { SessionLogger } from './sessionLogger'
import { buildSideEffectEntry, extractResourceIds } from './sideEffects'

export interface RecordToolActionOptions {
  actionLog: ActionLog
  conversationId: string
  reqId: string
  turnIndex: number
  callId: string
  toolName: string
  args: ToolArgs
  permission: ActionRecord['permission']
  status: ActionRecord['resultStatus']
  resultContent: string
  outputSpilloverThreshold: number
  startedAt: number
}

export interface RecordToolActionResult {
  durationMs: number
  resourceIds: string[]
  actionRecord: ActionRecord
}

export function recordToolAction(options: RecordToolActionOptions): RecordToolActionResult {
  const now = Date.now()
  const durationMs = now - options.startedAt
  const args = options.args as Record<string, unknown>
  const resourceIds = extractResourceIds(options.resultContent)
  const actionRecord: ActionRecord = {
    callId: options.callId,
    reqId: options.reqId,
    turnIndex: options.turnIndex,
    timestamp: now,
    toolName: options.toolName,
    args,
    resultStatus: options.status,
    resultSummary: options.resultContent.slice(0, 500),
    resultSize: options.resultContent.length,
    resultInOutputStore: options.resultContent.length > options.outputSpilloverThreshold,
    permission: options.permission,
    durationMs
  }

  options.actionLog.append(actionRecord)

  const sideEffect = buildSideEffectEntry(
    options.reqId,
    options.callId,
    options.toolName,
    options.args,
    options.status,
    options.resultContent
  )
  appendRunAction(options.conversationId, options.reqId, options.callId, sideEffect)

  if (resourceIds.length > 0) {
    updateRunManifest(options.conversationId, options.reqId, (manifest) => ({
      ...manifest,
      resourceIds: Array.from(new Set([...manifest.resourceIds, ...resourceIds]))
    }))
  }

  SessionLogger.logToolExecution(
    options.conversationId,
    options.callId,
    options.toolName,
    args,
    options.permission,
    options.status,
    durationMs,
    options.resultContent
  )

  return {
    durationMs,
    resourceIds,
    actionRecord
  }
}
