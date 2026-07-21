import { ipcMain, BrowserWindow } from 'electron'
import type { FileStore } from '../store'
import { handleChatCompletion, fetchModels, abortChatCompletion } from '../aiClient'
import {
  runAgentSkill,
  runGeneralAgent,
  resolveToolPermission,
  resolveUserChoice,
  abortAgentSkill
} from '../agent'
import { getToolRegistryView } from '../toolRegistry'
import { normalizeRuntimeError } from '../../shared/runtimeErrors'
import type {
  AdmitSessionPromptInput,
  AdmitSessionPromptResult,
  SessionPromptAdmission
} from '../../shared/types'
import { globalSessionCoordinator, SessionRunKind } from '../sessionCoordinator'
import { normalizeContextEpoch } from '../../shared/contextEpoch'
import type { AgentSteeringControls } from '../agent/agentRunPreparation'
import {
  admitSessionPrompt,
  cancelSessionPrompt,
  cancelStaleSessionPrompts,
  claimNextSessionPrompt,
  completeSessionPrompt,
  finishSessionPrompt,
  getSessionPrompt,
  listSessionPrompts,
  markSessionPromptRunning,
  requeueSessionPrompts
} from '../database/sessionPromptStore'

interface CoordinatedRunInput {
  reqId: string
  sessionId: string
  kind: SessionRunKind
  contextEpoch: number
  acceptsSteering?: boolean
  promptAdmissionId?: string
  execute: () => Promise<void>
  abort: () => void
}

const getSessionId = (reqId: string, options: unknown): string => {
  if (options && typeof options === 'object') {
    const sessionId = (options as Record<string, unknown>).sessionId
    if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim()
  }
  return reqId
}

const getContextEpoch = (options: unknown): number =>
  normalizeContextEpoch(
    options && typeof options === 'object'
      ? (options as Record<string, unknown>).contextEpoch
      : undefined
  )

const startCoordinatedRun = (win: BrowserWindow, input: CoordinatedRunInput): void => {
  void globalSessionCoordinator
    .start({
      reqId: input.reqId,
      sessionId: input.sessionId,
      kind: input.kind,
      contextEpoch: input.contextEpoch,
      acceptsSteering: input.acceptsSteering,
      onUnconsumedSteering: (prompts) => {
        requeueSessionPrompts(prompts.map((prompt) => prompt.admissionId))
      },
      execute: async (signal) => {
        const run = input.execute()
        const abort = (): void => input.abort()
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        try {
          await run
        } finally {
          signal.removeEventListener('abort', abort)
          if (input.promptAdmissionId) {
            finishSessionPrompt(input.promptAdmissionId, signal.aborted ? 'cancelled' : 'completed')
          }
        }
      }
    })
    .catch((error: unknown) => {
      if (input.promptAdmissionId) {
        requeueSessionPrompts([input.promptAdmissionId])
      }
      if (win.isDestroyed()) return
      const err = error instanceof Error ? error : new Error(String(error))
      win.webContents.send('chat-chunk', {
        reqId: input.reqId,
        contextEpoch: input.contextEpoch,
        error: err.message,
        errorPayload: normalizeRuntimeError(err, 'agent')
      })
    })
}

const createSteeringControls = (reqId: string): AgentSteeringControls => ({
  setSteeringAcceptance: (acceptsSteering) => {
    globalSessionCoordinator.setSteeringAcceptance(reqId, acceptsSteering)
  },
  drainSteering: (close) => globalSessionCoordinator.drainSteering(reqId, close),
  onSteeringConsumed: (admissionIds) => {
    for (const admissionId of admissionIds) completeSessionPrompt(admissionId)
  }
})

export function registerGenerationIpc(store: FileStore): void {
  ipcMain.handle(
    'admit-session-prompt',
    (_event, input: AdmitSessionPromptInput): AdmitSessionPromptResult => {
      if (!input || typeof input !== 'object') throw new Error('Prompt admission is required')
      const stored = admitSessionPrompt(input)
      if (!stored.inserted) {
        return { disposition: 'duplicate', prompt: stored.prompt }
      }

      if (
        input.mode === 'steer' &&
        globalSessionCoordinator.steer(input.sessionId, {
          admissionId: stored.prompt.id,
          contextEpoch: stored.prompt.contextEpoch,
          messages: stored.prompt.messages
        })
      ) {
        if (markSessionPromptRunning(stored.prompt.id)) {
          return {
            disposition: 'steered',
            prompt: getSessionPrompt(stored.prompt.id) || {
              ...stored.prompt,
              status: 'running'
            }
          }
        }
        globalSessionCoordinator.removeSteering(input.sessionId, stored.prompt.id)
      }

      return { disposition: 'queued', prompt: stored.prompt }
    }
  )

  ipcMain.handle('list-session-prompts', (_event, sessionId: string): SessionPromptAdmission[] =>
    listSessionPrompts(sessionId)
  )

  ipcMain.handle(
    'claim-next-session-prompt',
    (_event, sessionId: string, contextEpoch?: number): SessionPromptAdmission | undefined =>
      claimNextSessionPrompt(sessionId, contextEpoch)
  )

  ipcMain.on('advance-session-context', (_event, sessionId: string, contextEpoch: number) => {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return
    const normalizedEpoch = normalizeContextEpoch(contextEpoch)
    const currentEpoch = globalSessionCoordinator.getContextEpoch(normalizedSessionId)
    if (currentEpoch !== undefined && normalizedEpoch < currentEpoch) return
    globalSessionCoordinator.advanceContext(normalizedSessionId, normalizedEpoch)
    cancelStaleSessionPrompts(normalizedSessionId, normalizedEpoch)
  })

  ipcMain.handle('complete-session-prompt', (_event, admissionId: string): boolean =>
    completeSessionPrompt(admissionId)
  )

  ipcMain.handle('cancel-session-prompt', (_event, admissionId: string): boolean =>
    cancelSessionPrompt(admissionId)
  )

  ipcMain.handle(
    'requeue-session-prompt',
    (_event, admissionId: string): boolean => requeueSessionPrompts([admissionId]) === 1
  )

  ipcMain.handle('list-agent-tools', () => {
    return getToolRegistryView()
      .list()
      .filter((tool) => tool.implemented && tool.discoverable)
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        source: tool.source || 'builtin',
        parameters: tool.parameters
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  })

  ipcMain.handle('fetch-models', (_event, fetchUrl, apiKey, providerConnection) => {
    return fetchModels(fetchUrl, apiKey, providerConnection)
  })

  ipcMain.on('start-chat-completion', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const normalizedReqId = String(reqId || '')
      const sessionId = getSessionId(normalizedReqId, options)
      const contextEpoch = getContextEpoch(options)
      const permissions = store.get('settings').permissions
      if (options.runMode === 'agent') {
        const systemPrompt = store.get('settings').systemPrompt
        const steeringControls = createSteeringControls(normalizedReqId)
        startCoordinatedRun(win, {
          reqId: normalizedReqId,
          sessionId,
          contextEpoch,
          kind: 'agent',
          acceptsSteering: true,
          promptAdmissionId: options.promptAdmissionId,
          execute: () =>
            runGeneralAgent(
              win,
              normalizedReqId,
              { ...options, systemPrompt, ...steeringControls },
              permissions
            ),
          abort: () => abortAgentSkill(normalizedReqId)
        })
      } else {
        startCoordinatedRun(win, {
          reqId: normalizedReqId,
          sessionId,
          contextEpoch,
          kind: 'chat',
          promptAdmissionId: options.promptAdmissionId,
          execute: () => handleChatCompletion(win, normalizedReqId, options),
          abort: () => abortChatCompletion(normalizedReqId)
        })
      }
    }
  })

  ipcMain.on('start-agent-skill', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const normalizedReqId = String(reqId || '')
      const contextEpoch = getContextEpoch(options)
      const permissions = store.get('settings').permissions
      const steeringControls = createSteeringControls(normalizedReqId)
      startCoordinatedRun(win, {
        reqId: normalizedReqId,
        sessionId: getSessionId(normalizedReqId, options),
        contextEpoch,
        kind: 'skill',
        acceptsSteering: true,
        promptAdmissionId: options.promptAdmissionId,
        execute: () =>
          runAgentSkill(win, normalizedReqId, { ...options, ...steeringControls }, permissions),
        abort: () => abortAgentSkill(normalizedReqId)
      })
    }
  })

  ipcMain.on('respond-tool-permission', (_event, reqId, callId, approved) => {
    resolveToolPermission(reqId, callId, approved)
  })

  ipcMain.on('respond-user-choice', (_event, reqId, requestId, response) => {
    resolveUserChoice(String(reqId || ''), String(requestId || ''), response || {})
  })

  ipcMain.on('abort-generation', (_event, reqId) => {
    const normalizedReqId = String(reqId || '')
    if (!globalSessionCoordinator.abortRequest(normalizedReqId)) {
      abortChatCompletion(normalizedReqId)
      abortAgentSkill(normalizedReqId)
    }
  })
}
