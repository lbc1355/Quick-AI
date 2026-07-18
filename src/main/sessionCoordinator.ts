import { ChatCompletionMessage } from '../shared/types'
import { normalizeContextEpoch } from '../shared/contextEpoch'

export type SessionRunKind = 'chat' | 'agent' | 'skill'

export interface SessionSteeringPrompt {
  admissionId: string
  contextEpoch?: number
  messages: ChatCompletionMessage[]
}

export interface SessionRunSnapshot {
  sessionId: string
  reqId: string
  kind: SessionRunKind
  contextEpoch: number
  startedAt: number
  cancelling: boolean
  acceptsSteering: boolean
  pendingSteeringCount: number
}

export interface StartSessionRunOptions {
  sessionId: string
  reqId: string
  kind: SessionRunKind
  contextEpoch?: number
  acceptsSteering?: boolean
  onUnconsumedSteering?: (prompts: SessionSteeringPrompt[]) => void
  execute: (signal: AbortSignal) => Promise<void>
}

interface ActiveSessionRun extends SessionRunSnapshot {
  controller: AbortController
  steering: SessionSteeringPrompt[]
}

export class SessionBusyError extends Error {
  readonly sessionId: string
  readonly activeReqId: string

  constructor(sessionId: string, activeReqId: string) {
    super('Session ' + sessionId + ' is already running request ' + activeReqId)
    this.name = 'SessionBusyError'
    this.sessionId = sessionId
    this.activeReqId = activeReqId
  }
}

export class StaleSessionContextError extends Error {
  readonly sessionId: string
  readonly expectedEpoch: number
  readonly receivedEpoch: number

  constructor(sessionId: string, expectedEpoch: number, receivedEpoch: number) {
    super(
      `Session ${sessionId} context epoch ${receivedEpoch} is stale; current epoch is ${expectedEpoch}`
    )
    this.name = 'StaleSessionContextError'
    this.sessionId = sessionId
    this.expectedEpoch = expectedEpoch
    this.receivedEpoch = receivedEpoch
  }
}

/** Process-local foreground run coordinator. Durable prompt admission is layered above this. */
export class SessionCoordinator {
  private readonly bySession = new Map<string, ActiveSessionRun>()
  private readonly sessionByRequest = new Map<string, string>()
  private readonly contextEpochBySession = new Map<string, number>()

  async start(options: StartSessionRunOptions): Promise<void> {
    const sessionId = options.sessionId.trim()
    const reqId = options.reqId.trim()
    const contextEpoch = normalizeContextEpoch(options.contextEpoch)
    if (!sessionId) throw new Error('Session id is required')
    if (!reqId) throw new Error('Request id is required')

    const knownEpoch = this.contextEpochBySession.get(sessionId)
    if (knownEpoch !== undefined && contextEpoch < knownEpoch) {
      throw new StaleSessionContextError(sessionId, knownEpoch, contextEpoch)
    }
    if (knownEpoch === undefined || contextEpoch > knownEpoch) {
      this.advanceContext(sessionId, contextEpoch)
    }

    const activeForSession = this.bySession.get(sessionId)
    if (activeForSession) {
      throw new SessionBusyError(sessionId, activeForSession.reqId)
    }

    const requestSessionId = this.sessionByRequest.get(reqId)
    if (requestSessionId) {
      throw new SessionBusyError(requestSessionId, reqId)
    }

    const active: ActiveSessionRun = {
      sessionId,
      reqId,
      kind: options.kind,
      contextEpoch,
      startedAt: Date.now(),
      cancelling: false,
      acceptsSteering: options.acceptsSteering === true,
      pendingSteeringCount: 0,
      steering: [],
      controller: new AbortController()
    }
    this.bySession.set(sessionId, active)
    this.sessionByRequest.set(reqId, sessionId)

    try {
      await options.execute(active.controller.signal)
    } finally {
      if (this.bySession.get(sessionId) === active) {
        this.bySession.delete(sessionId)
      }
      if (this.sessionByRequest.get(reqId) === sessionId) {
        this.sessionByRequest.delete(reqId)
      }
      active.acceptsSteering = false
      const unconsumed = active.steering.splice(0)
      active.pendingSteeringCount = 0
      if (unconsumed.length > 0 && options.onUnconsumedSteering) {
        try {
          options.onUnconsumedSteering(unconsumed)
        } catch (error) {
          console.error('Failed to requeue unconsumed steering prompts:', error)
        }
      }
    }
  }

  steer(sessionId: string, prompt: SessionSteeringPrompt): boolean {
    const active = this.bySession.get(sessionId)
    if (!active || !active.acceptsSteering || active.cancelling) return false
    if (normalizeContextEpoch(prompt.contextEpoch) !== active.contextEpoch) return false
    if (!prompt.admissionId.trim() || prompt.messages.length === 0) return false
    if (active.steering.some((item) => item.admissionId === prompt.admissionId)) return true
    active.steering.push(prompt)
    active.pendingSteeringCount = active.steering.length
    return true
  }

  removeSteering(sessionId: string, admissionId: string): boolean {
    const active = this.bySession.get(sessionId)
    if (!active) return false
    const index = active.steering.findIndex((item) => item.admissionId === admissionId)
    if (index < 0) return false
    active.steering.splice(index, 1)
    active.pendingSteeringCount = active.steering.length
    return true
  }

  setSteeringAcceptance(reqId: string, acceptsSteering: boolean): boolean {
    const active = this.getActiveRunByRequest(reqId)
    if (!active || active.cancelling) return false
    active.acceptsSteering = acceptsSteering
    return true
  }

  drainSteering(reqId: string, close = false): SessionSteeringPrompt[] {
    const active = this.getActiveRunByRequest(reqId)
    if (!active) return []
    if (close) active.acceptsSteering = false
    const prompts = active.steering.splice(0)
    active.pendingSteeringCount = 0
    return prompts
  }

  abortRequest(reqId: string): boolean {
    const sessionId = this.sessionByRequest.get(reqId)
    if (!sessionId) return false
    return this.abortActive(this.bySession.get(sessionId))
  }

  abortSession(sessionId: string): boolean {
    return this.abortActive(this.bySession.get(sessionId))
  }

  advanceContext(sessionId: string, contextEpoch: number): boolean {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) return false
    const nextEpoch = normalizeContextEpoch(contextEpoch)
    const currentEpoch = this.contextEpochBySession.get(normalizedSessionId)
    if (currentEpoch !== undefined && nextEpoch <= currentEpoch) return false
    this.contextEpochBySession.set(normalizedSessionId, nextEpoch)
    const active = this.bySession.get(normalizedSessionId)
    if (active && active.contextEpoch < nextEpoch) this.abortActive(active)
    return true
  }

  getContextEpoch(sessionId: string): number | undefined {
    return this.contextEpochBySession.get(sessionId)
  }

  getActiveSession(sessionId: string): SessionRunSnapshot | undefined {
    return this.snapshot(this.bySession.get(sessionId))
  }

  getActiveRequest(reqId: string): SessionRunSnapshot | undefined {
    const sessionId = this.sessionByRequest.get(reqId)
    return sessionId ? this.getActiveSession(sessionId) : undefined
  }

  listActive(): SessionRunSnapshot[] {
    return Array.from(this.bySession.values(), (active) => this.snapshot(active)!)
  }

  private abortActive(active: ActiveSessionRun | undefined): boolean {
    if (!active) return false
    active.cancelling = true
    active.acceptsSteering = false
    active.controller.abort()
    return true
  }

  private getActiveRunByRequest(reqId: string): ActiveSessionRun | undefined {
    const sessionId = this.sessionByRequest.get(reqId)
    return sessionId ? this.bySession.get(sessionId) : undefined
  }

  private snapshot(active: ActiveSessionRun | undefined): SessionRunSnapshot | undefined {
    if (!active) return undefined
    return {
      sessionId: active.sessionId,
      reqId: active.reqId,
      kind: active.kind,
      contextEpoch: active.contextEpoch,
      startedAt: active.startedAt,
      cancelling: active.cancelling,
      acceptsSteering: active.acceptsSteering,
      pendingSteeringCount: active.steering.length
    }
  }
}

export const globalSessionCoordinator = new SessionCoordinator()
