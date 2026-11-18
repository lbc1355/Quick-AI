import { getSessionContextEpoch } from '../../../../shared/contextEpoch'
import type { RendererStartupTiming } from '../../../../shared/runTiming'
import type { Session, SessionPromptAdmission } from '../../../../shared/types'
import { createRunId } from './runIdentity'
import {
  materializeBackgroundPrompt,
  prepareClaimedPromptRun,
  type PreparedClaimedPromptRun
} from './sessionPromptQueue'

interface QueuedPromptRun extends PreparedClaimedPromptRun {
  admission: SessionPromptAdmission
  reqId: string
  contextEpoch: number
  startupTiming: RendererStartupTiming
}

interface QueuedPromptDependencies {
  inbox: {
    claimNextSessionPrompt: (
      sessionId: string,
      contextEpoch: number
    ) => Promise<SessionPromptAdmission | undefined>
    cancelClaimedSessionPrompt: (admissionId: string) => Promise<boolean>
    requeueSessionPrompt: (admissionId: string) => Promise<boolean>
  }
  getSession: (sessionId: string) => Session | undefined
  updateSession: (session: Session) => Session[]
  isRunActive: (sessionId: string) => boolean
  beginRun: (sessionId: string, reqId: string, assistantMessageId: string) => void
  finishRun: (sessionId: string, reqId: string) => void
  persistSessions: (sessions: Session[]) => Promise<void>
  launchRun: (run: QueuedPromptRun) => void
}

interface QueuedPromptRunner {
  isDraining: (sessionId: string) => boolean
  drainNext: (sessionId: string, dependencies: QueuedPromptDependencies) => Promise<void>
}

export function createQueuedPromptRunner(): QueuedPromptRunner {
  const draining = new Set<string>()

  return {
    isDraining: (sessionId) => draining.has(sessionId),
    async drainNext(sessionId, dependencies) {
      const { inbox, getSession, isRunActive } = dependencies
      if (!sessionId || draining.has(sessionId) || isRunActive(sessionId)) return

      draining.add(sessionId)
      let claimedAdmissionId: string | undefined
      let registeredReqId: string | undefined
      try {
        const sessionAtClaim = getSession(sessionId)
        if (!sessionAtClaim) return
        const contextEpoch = getSessionContextEpoch(sessionAtClaim)
        const admission = await inbox.claimNextSessionPrompt(sessionId, contextEpoch)
        if (!admission) return
        claimedAdmissionId = admission.id

        if (isRunActive(sessionId)) {
          await inbox.requeueSessionPrompt(admission.id)
          return
        }

        const sourceSession = getSession(sessionId)
        if (
          !sourceSession ||
          !admission.assistantMessageId ||
          admission.contextEpoch !== getSessionContextEpoch(sourceSession)
        ) {
          await inbox.cancelClaimedSessionPrompt(admission.id)
          return
        }

        const reqId = createRunId('queued-run-')
        const prepared = prepareClaimedPromptRun(
          materializeBackgroundPrompt(sourceSession, admission),
          admission.sourceMessageId,
          admission.assistantMessageId,
          reqId,
          admission.runMode
        )
        if (!prepared) {
          await inbox.cancelClaimedSessionPrompt(admission.id)
          return
        }

        const nextSessions = dependencies.updateSession(prepared.session)
        registeredReqId = reqId
        dependencies.beginRun(sessionId, reqId, prepared.assistantMessageId)
        const persistStartedAt = Date.now()
        const persistStarted = performance.now()
        await dependencies.persistSessions(nextSessions)

        // Clearing or rewinding a conversation during the write invalidates this admission.
        const currentSession = getSession(sessionId)
        if (!currentSession || getSessionContextEpoch(currentSession) !== contextEpoch) {
          await inbox.cancelClaimedSessionPrompt(admission.id)
          claimedAdmissionId = undefined
          dependencies.finishRun(sessionId, reqId)
          return
        }

        const startupTiming: RendererStartupTiming = {
          startedAt: persistStartedAt,
          persistedAt: Date.now(),
          paintWaitMs: 0,
          persistenceMs: performance.now() - persistStarted
        }

        dependencies.launchRun({ ...prepared, admission, reqId, contextEpoch, startupTiming })
      } catch (error) {
        console.warn('Failed to drain queued prompt:', error)
        if (claimedAdmissionId) {
          await inbox.requeueSessionPrompt(claimedAdmissionId).catch(console.warn)
        }
        if (registeredReqId) dependencies.finishRun(sessionId, registeredReqId)
      } finally {
        draining.delete(sessionId)
      }
    }
  }
}
