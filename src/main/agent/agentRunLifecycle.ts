import { AgentEvent } from '../../shared/types'
import {
  AgentRunContext,
  createRun as defaultCreateRun,
  destroyRun as defaultDestroyRun
} from './AgentRunContext'
import { ActionLog } from './actionLog'
import { SessionLogger } from './sessionLogger'
import {
  RunManifestStatus,
  createRunManifest as defaultCreateRunManifest,
  finishRunManifest as defaultFinishRunManifest
} from './runManifest'

type PermissionPolicy = { [toolName: string]: 'allow' | 'ask' | 'deny' }
type ToolScope = Set<string> | 'all'
type RunEndStatus = Exclude<RunManifestStatus, 'running'>

export interface StartAgentRunLifecycleDependencies {
  createRun?: typeof defaultCreateRun
  destroyRun?: typeof defaultDestroyRun
  createRunManifest?: typeof defaultCreateRunManifest
  finishRunManifest?: typeof defaultFinishRunManifest
  logRunEnd?: typeof SessionLogger.logRunEnd
}

export interface StartAgentRunLifecycleOptions {
  reqId: string
  conversationId: string
  maxSteps: number
  initialActiveTools: string[]
  toolScope: ToolScope
  actionLog: ActionLog
  permissions?: PermissionPolicy
  sessionId?: string
  projectRoot?: string
  projectName?: string
  sourceMessageId?: string
  assistantMessageId?: string
  parentRunId?: string
  branchOf?: { sessionId: string; messageId: string; runId?: string }
  emitEvent: (event: AgentEvent) => void
  dependencies?: StartAgentRunLifecycleDependencies
}

export interface AgentRunLifecycle {
  runCtx: AgentRunContext
  signal: AbortSignal
  finish: (status: RunEndStatus, error?: string) => void
  destroy: () => void
}

export function startAgentRunLifecycle(options: StartAgentRunLifecycleOptions): AgentRunLifecycle {
  const dependencies = options.dependencies || {}
  const createRun = dependencies.createRun || defaultCreateRun
  const destroyRun = dependencies.destroyRun || defaultDestroyRun
  const createRunManifest = dependencies.createRunManifest || defaultCreateRunManifest
  const finishRunManifest = dependencies.finishRunManifest || defaultFinishRunManifest
  const logRunEnd =
    dependencies.logRunEnd ||
    ((sessionId: string, status: string, error?: string): void => {
      SessionLogger.logRunEnd(sessionId, status, error)
    })

  const runCtx = createRun(
    options.reqId,
    options.initialActiveTools,
    options.toolScope,
    options.actionLog,
    options.permissions,
    options.sessionId,
    options.projectRoot,
    options.projectName
  )
  runCtx.maxSteps = options.maxSteps

  createRunManifest({
    runId: options.reqId,
    sessionId: options.conversationId,
    sourceMessageId: options.sourceMessageId,
    assistantMessageId: options.assistantMessageId,
    parentRunId: options.parentRunId,
    branchOf: options.branchOf
  })

  return {
    runCtx,
    signal: runCtx.signal,
    finish: (status, error) => {
      runCtx.status = status
      runCtx.completedAt = Date.now()
      if (error) {
        runCtx.error = error
      }
      finishRunManifest(options.conversationId, options.reqId, status, error)
      options.emitEvent({
        type: 'agent_end',
        status,
        error
      })
      logRunEnd(options.conversationId, status, error)
    },
    destroy: () => {
      destroyRun(options.reqId)
    }
  }
}
