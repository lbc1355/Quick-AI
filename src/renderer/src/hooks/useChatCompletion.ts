import React, { useEffect, useRef, useState } from 'react'
import { useToast } from '../contexts/ToastContext'
import {
  ContextRetentionMode,
  Message,
  ModelRuntimeConfig,
  Project,
  ReasoningPreference,
  ResolvedProviderConnection,
  Session,
  Skill,
  RunMode,
  SessionPromptAdmissionMode,
  SessionRunStateNotification,
  BackgroundShellResultNotification,
  BackgroundSubagentResultNotification,
  BackgroundSubagentEventNotification
} from '../../../shared/types'
import { startStreamingRun as startChatStreamingRun } from './chatStreaming'
import { getSessionContextEpoch } from '../../../shared/contextEpoch'

// Extracted pure helper functions
import { buildApiMessages } from '../features/chat/apiMessageBuilder'
import {
  buildAgentSkillRunOptions,
  buildChatRunOptions,
  needsApiKeyBeforeRun,
  resolveEffectiveRunMode,
  type ChatRequestConfig
} from '../features/chat/chatRunRequest'
import {
  createAssistantPlaceholder,
  createHelpMessage,
  createQueuedAssistantPlaceholder,
  createUserMessage,
  markMessageAsRuntimeError
} from '../features/chat/chatMessageFactory'
import {
  applyCompactionResult,
  canCompactMessages,
  MANUAL_COMPACTION_KEEP_RECENT_MESSAGES
} from '../features/chat/contextCompaction'
import {
  createMessagePairIds,
  createRunId,
  deriveSessionTitle,
  shouldAutoDeriveSessionTitle
} from '../features/chat/runIdentity'
import {
  cloneSessionsDeep,
  cloneSessionInSnapshot,
  planRemovedRunCleanup,
  planStagedRevertCommit,
  replaceSessionInSnapshot,
  touchSessionInSnapshot
} from '../features/chat/sessionSnapshot'
import {
  applyEpochScopedNotification,
  applyEpochScopedNotifications,
  shouldDrainAfterNotification
} from '../features/chat/backgroundNotifications'
import {
  resolveSessionForSend,
  prepareEditOrForkMutation,
  prepareResumeMutation
} from '../features/chat/sessionMutationService'
import {
  appendQueuedPromptToSession,
  applyBackgroundShellNotification,
  applyBackgroundSubagentEventNotification,
  applyBackgroundSubagentNotification,
  applySteeredAdmission,
  markQueuedPromptInSessions,
  materializeBackgroundPrompt,
  prepareClaimedPromptRun,
  removeQueuedPromptFromSessions,
  withoutQueuedPrompt
} from '../features/chat/sessionPromptQueue'
import {
  applySessionRunState,
  getActiveRequestIds,
  getGeneratingSessionIds,
  registerSessionGeneration,
  SessionGenerationRegistry,
  unregisterSessionGeneration
} from '../utils/generationState'

export {
  isRuntimeErrorAssistantMessage,
  mergeResourceUpdate,
  prepareMessageForInlineResume
} from './chatMessageEvents'
export {
  createForkedSession,
  forkResourcesForRuns,
  getRunIdsThroughMessage
} from './sessionBranching'
export { touchSessionInSnapshot } from '../features/chat/sessionSnapshot'

interface UseChatCompletionProps {
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>
  activeSessionId: string
  sessionsRef: React.MutableRefObject<Session[]>
  projects: Project[]
  apiKey: string
  apiUrl: string
  providerConnection?: ResolvedProviderConnection
  selectedModel: string
  modelRuntimeConfig?: ModelRuntimeConfig
  contextWindowTokens?: number
  contextRetentionMode: ContextRetentionMode
  systemPrompt: string
  setShowSettings: (show: boolean) => void
  attachedFiles: Array<{ name: string; content: string; type: string }>
  setAttachedFiles: React.Dispatch<
    React.SetStateAction<Array<{ name: string; content: string; type: string }>>
  >
  draftSession: Session | null
  setDraftSession: React.Dispatch<React.SetStateAction<Session | null>>
  /** Resolve the snapshotted thinking preference for a session at dispatch time. */
  resolveReasoningPreference: (session: Session) => ReasoningPreference
}

export interface UseChatCompletionReturn {
  inputVal: string
  setInputVal: React.Dispatch<React.SetStateAction<string>>
  isGenerating: boolean
  generatingSessionIds: ReadonlySet<string>
  activeRequestId: string | null
  activeRequestIds: ReadonlySet<string>
  cancellingQueuedPromptIds: ReadonlySet<string>
  editingMessageId: string | null
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>
  editingText: string
  setEditingText: React.Dispatch<React.SetStateAction<string>>
  runMode: RunMode
  setRunMode: React.Dispatch<React.SetStateAction<RunMode>>
  handleSendMessage: (
    customPrompt?: string,
    customMsgId?: string,
    options?: SendMessageOptions
  ) => Promise<boolean>
  handleAdmitPrompt: (prompt: string, mode: SessionPromptAdmissionMode) => Promise<boolean>
  handleCancelQueuedPrompt: (msg: Message) => Promise<void>
  handleRunAgentSkill: (skill: Skill, userInput: string) => Promise<void>
  handleStartEdit: (msg: Message) => void
  handleSaveEdit: (msgId: string) => void
  handleRegenerate: (msgIdx: number) => void
  handleResumeAgentRun: (msgIdx: number) => Promise<void>
  showHelpMessage: () => Promise<void>
  handleCompactCurrentSession: () => Promise<boolean>
  /** Active /compact progress (session id + start time) so the UI can show a live dock. */
  compaction: { sessionId: string; startedAt: number } | null
  cancelCompaction: () => void
  handleAbortGeneration: () => void
}

interface SendMessageOptions {
  branchSource?: { messageId: string; runId?: string }
  forceBranch?: boolean
}

const waitForRendererPaint = (): Promise<void> =>
  new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(fallback)
      resolve()
    }
    const fallback = window.setTimeout(finish, 50)
    if (typeof window.requestAnimationFrame !== 'function') return
    window.requestAnimationFrame(() => window.setTimeout(finish, 0))
  })

export const useChatCompletion = ({
  setSessions,
  setActiveSessionId,
  activeSessionId,
  sessionsRef,
  projects,
  apiKey,
  apiUrl,
  providerConnection,
  selectedModel,
  modelRuntimeConfig,
  contextWindowTokens,
  contextRetentionMode,
  systemPrompt,
  setShowSettings,
  attachedFiles,
  setAttachedFiles,
  draftSession,
  setDraftSession,
  resolveReasoningPreference
}: UseChatCompletionProps): UseChatCompletionReturn => {
  const toast = useToast()
  const [inputVal, setInputVal] = useState('')
  const draftSessionRef = useRef<Session | null>(null)
  const resolveReasoningPreferenceRef = useRef(resolveReasoningPreference)
  useEffect(() => {
    draftSessionRef.current = draftSession
  }, [draftSession])
  useEffect(() => {
    resolveReasoningPreferenceRef.current = resolveReasoningPreference
  }, [resolveReasoningPreference])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const activeGenerationsRef = useRef<SessionGenerationRegistry>(new Map())
  const [generatingSessionIds, setGeneratingSessionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [activeRequestIds, setActiveRequestIds] = useState<ReadonlySet<string>>(() => new Set())
  /** Live /compact progress keyed by session — several sessions can compact concurrently, and
   *  each dock/cancel must be scoped to its own session. */
  const [compactionBySession, setCompactionBySession] = useState<Record<string, number>>({})
  const cancellingQueuedPromptIdsRef = useRef<Set<string>>(new Set())
  const [cancellingQueuedPromptIds, setCancellingQueuedPromptIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const queueDrainInProgressRef = useRef<Set<string>>(new Set())
  const drainQueuedPromptRef = useRef<(sessionId: string) => Promise<void>>(async () => undefined)
  const admitPromptRef = useRef<
    (prompt: string, mode: SessionPromptAdmissionMode) => Promise<boolean>
  >(async () => false)
  const backgroundSubagentEventQueueRef = useRef<BackgroundSubagentEventNotification[]>([])
  const backgroundSubagentEventFrameRef = useRef<number | null>(null)
  const flushBackgroundSubagentEventsRef = useRef<() => void>(() => undefined)
  const [runMode, setRunMode] = useState<RunMode>('chat')

  const publishGeneratingSessions = (): void => {
    setGeneratingSessionIds(getGeneratingSessionIds(activeGenerationsRef.current))
    setActiveRequestIds(getActiveRequestIds(activeGenerationsRef.current))
  }

  const beginSessionGeneration = (
    sessionId: string,
    requestId: string | null,
    assistantMessageId: string | null
  ): void => {
    activeGenerationsRef.current = registerSessionGeneration(
      activeGenerationsRef.current,
      sessionId,
      {
        requestId,
        assistantMessageId,
        phase: 'generating'
      }
    )
    publishGeneratingSessions()
  }

  const finishSessionGeneration = (sessionId: string, requestId: string | null): void => {
    const next = unregisterSessionGeneration(activeGenerationsRef.current, sessionId, requestId)
    if (next === activeGenerationsRef.current) return
    activeGenerationsRef.current = next
    publishGeneratingSessions()
  }

  const isSessionGenerating = (sessionId: string): boolean =>
    activeGenerationsRef.current.get(sessionId)?.phase === 'generating'

  const isSessionRunActive = (sessionId: string): boolean =>
    activeGenerationsRef.current.has(sessionId)

  const isSessionBusy = (sessionId: string): boolean =>
    isSessionRunActive(sessionId) || queueDrainInProgressRef.current.has(sessionId)

  const isGenerating = generatingSessionIds.size > 0
  const activeGeneration = activeGenerationsRef.current.get(activeSessionId)
  const activeRequestId =
    activeGeneration?.phase === 'generating' ? activeGeneration.requestId : null

  const handleSessionRunStateRef = useRef<(state: SessionRunStateNotification) => void>(
    () => undefined
  )
  handleSessionRunStateRef.current = (state): void => {
    const next = applySessionRunState(activeGenerationsRef.current, state)
    if (next === activeGenerationsRef.current) return
    activeGenerationsRef.current = next
    publishGeneratingSessions()
    if (state.phase === 'idle') {
      window.setTimeout(() => {
        void drainQueuedPromptRef.current(state.sessionId)
      }, 0)
    }
  }

  useEffect(() => {
    return window.api.onSessionRunState((state) => handleSessionRunStateRef.current(state))
  }, [])

  const latestRequestConfigRef = useRef<ChatRequestConfig>({
    apiKey,
    apiUrl,
    providerConnection,
    selectedModel,
    modelRuntimeConfig,
    contextWindowTokens,
    contextRetentionMode,
    systemPrompt,
    projects
  })
  useEffect(() => {
    latestRequestConfigRef.current = {
      apiKey,
      apiUrl,
      providerConnection,
      selectedModel,
      modelRuntimeConfig,
      contextWindowTokens,
      contextRetentionMode,
      systemPrompt,
      projects
    }
  }, [
    apiKey,
    apiUrl,
    providerConnection,
    selectedModel,
    modelRuntimeConfig,
    contextWindowTokens,
    contextRetentionMode,
    systemPrompt,
    projects
  ])

  // Mirror runMode in a ref so dispatch always reads the live value. handleSendMessage can be
  // captured in a stale closure — MessageBubble is memoized and its comparator ignores callback
  // props, so the onRegenerate/onSaveEdit it holds may close over an older runMode than the toggle
  // currently shows. Reading the ref (stable across renders) instead of the closed-over `runMode`
  // ensures regenerate/edit after toggling honours the current mode.
  const runModeRef = useRef(runMode)
  useEffect(() => {
    runModeRef.current = runMode
  }, [runMode])

  /** Guard shared by every dispatch: warn and open settings when the key is required but unset. */
  const ensureApiKey = (config: ChatRequestConfig, message: string): boolean => {
    if (!needsApiKeyBeforeRun(config)) return true
    toast.warning(message)
    setShowSettings(true)
    return false
  }

  // Replace a single message in the active session, keeping sessionsRef in sync.
  const updateMessageById = (
    msgId: string,
    updater: (m: Message) => Message,
    touchActiveTime = true,
    sessionId = activeSessionId
  ): void => {
    setSessions((prevSessions) => {
      const next = prevSessions.map((s) => {
        if (s.id !== sessionId) return s
        return {
          ...s,
          messages: s.messages.map((m) => (m.id === msgId ? updater(m) : m)),
          ...(touchActiveTime ? { lastActiveTime: Date.now() } : {})
        }
      })
      sessionsRef.current = next
      return next
    })
  }

  const sessionPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistSessionsSnapshot = async (snapshot: Session[]): Promise<void> => {
    const stableSnapshot = cloneSessionsDeep(snapshot)
    const write = sessionPersistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await window.api.storeSet('sessions', stableSnapshot)
      })
    sessionPersistenceQueueRef.current = write.catch(() => undefined)
    await write
  }

  const persistSessionsSnapshotSoon = (snapshot: Session[]): void => {
    void persistSessionsSnapshot(snapshot).catch((err) => {
      console.warn('Failed to persist sessions snapshot:', err)
    })
  }

  const persistBeforeStreaming = async (
    snapshot: Session[],
    sessionId: string,
    requestId: string
  ): Promise<void> => {
    try {
      // Let React commit and paint the optimistic user/assistant message pair before cloning and
      // serializing the full durable snapshot. This is most visible on a brand-new conversation.
      await waitForRendererPaint()
      await persistSessionsSnapshot(snapshot)
    } catch (error) {
      finishSessionGeneration(sessionId, requestId)
      throw error
    }
  }

  /** Commit a staged rollback and fire the disk cleanup the plan asks for. */
  const commitStagedRevert = (
    sessions: Session[],
    sourceSession: Session
  ): { session: Session; sessions: Session[] } => {
    const plan = planStagedRevertCommit(sessions, sourceSession)
    if (plan.cacheCleanup) {
      void window.api.clearSessionCaches(plan.cacheCleanup).catch(console.warn)
    }
    return { session: plan.session, sessions: plan.sessions }
  }

  // Persist the full in-memory snapshot after a run finishes. Branch relationships are spread
  // across sessions, so persisting only one session can lose newly-created branch metadata.
  const persistActiveSession = (sessionId = activeSessionId): void => {
    setTimeout(() => {
      const updatedSessions = touchSessionInSnapshot(sessionsRef.current, sessionId, Date.now())
      sessionsRef.current = updatedSessions
      setSessions(updatedSessions)
      persistSessionsSnapshotSoon(updatedSessions)
    }, 300)
  }

  const startStreamingRun = (
    reqId: string,
    sessionId: string,
    assistantMsgId: string,
    contextEpoch: number,
    start: () => void,
    formatError: (msg: string) => string
  ): void => {
    startChatStreamingRun({
      reqId,
      sessionId,
      assistantMsgId,
      contextEpoch,
      start,
      formatError,
      setSessions,
      sessionsRef,
      updateMessageById,
      persistActiveSession
    })
  }

  const handleAbortGeneration = (): void => {
    const requestId = activeGenerationsRef.current.get(activeSessionId)?.requestId
    if (requestId) {
      // Just signal the main process. It always replies with a { cancelled, done }
      // chunk, which drives cleanup() from a single source of truth
      // and preserving whatever content was already streamed.
      window.api.abortGeneration(requestId)
    }
  }

  const showHelpMessage = async (): Promise<void> => {
    if (!activeSessionId) return
    const cloned = cloneSessionsDeep(sessionsRef.current)
    const active = cloned.find((session) => session.id === activeSessionId)
    if (!active) return

    const reverted = commitStagedRevert(cloned, active)
    const updated = replaceSessionInSnapshot(reverted.sessions, {
      ...reverted.session,
      messages: [...reverted.session.messages, createHelpMessage(Date.now())],
      lastActiveTime: Date.now()
    })

    setSessions(updated)
    sessionsRef.current = updated
    await window.api.storeSet('sessions', updated)
  }

  const handleCompactCurrentSession = async (): Promise<boolean> => {
    const requestConfig = latestRequestConfigRef.current
    if (isSessionBusy(activeSessionId)) return false
    if (!ensureApiKey(requestConfig, '请先在设置中填写 DeepSeek API Key。')) return false

    const currentSessions = cloneSessionsDeep(sessionsRef.current)
    const found = currentSessions.find((s) => s.id === activeSessionId)
    if (!found) return false

    if (!canCompactMessages(found.messages)) {
      toast.info('当前对话可压缩内容不足。')
      setInputVal('')
      return true
    }

    const revertPlan = planStagedRevertCommit(currentSessions, found)
    const currentSession = revertPlan.session
    const revertCacheCleanup = revertPlan.cacheCleanup

    beginSessionGeneration(currentSession.id, null, null)
    setInputVal('')
    // The transcript stays untouched while compaction runs — a dock shows the progress instead
    // of a phantom message that would shift the scroll position and pollute the history.
    setCompactionBySession((prev) => ({ ...prev, [currentSession.id]: Date.now() }))

    try {
      const result = await window.api.compactContext({
        sessionId: currentSession.id,
        apiUrl: requestConfig.apiUrl,
        apiKey: requestConfig.apiKey,
        providerConnection: requestConfig.providerConnection,
        model: requestConfig.selectedModel,
        modelRuntime: requestConfig.modelRuntimeConfig,
        messages: currentSession.messages,
        keepRecentMessages: MANUAL_COMPACTION_KEEP_RECENT_MESSAGES,
        systemPrompt: requestConfig.systemPrompt
      })

      // Apply the summary to the LATEST session, not the stale clone: a background result may have
      // landed while the model was summarizing. Preserve anything appended after the compaction
      // boundary instead of overwriting it with the pre-compaction snapshot.
      const latest = sessionsRef.current.find((session) => session.id === currentSession.id)
      if (!latest || getSessionContextEpoch(latest) !== getSessionContextEpoch(currentSession)) {
        return false
      }
      // Only now is the staged rollback's cache cleanup safe to fire — on failure/cancel the
      // revert stays fully intact (UI + caches), so restore can still succeed.
      if (revertCacheCleanup) {
        void window.api.clearSessionCaches(revertCacheCleanup).catch(console.warn)
      }
      const mergedSession = {
        ...latest,
        messages: applyCompactionResult({ messages: latest.messages, result, now: Date.now() }),
        revert: undefined,
        contextEpoch: getSessionContextEpoch(latest) + 1,
        lastActiveTime: Date.now()
      }
      window.api.advanceSessionContext(mergedSession.id, mergedSession.contextEpoch)
      const updatedSessions = replaceSessionInSnapshot(sessionsRef.current, mergedSession)
      setSessions(updatedSessions)
      sessionsRef.current = updatedSessions
      persistSessionsSnapshotSoon(updatedSessions)
      toast.success(`压缩完成：前 ${result.compactedCount} 条历史消息已总结为摘要。`)
      return true
    } catch (err) {
      const aborted =
        err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message || ''))
      if (!aborted) {
        toast.error(
          `上下文压缩失败：${err instanceof Error ? err.message : String(err || '上下文压缩失败')}`
        )
      }
      return false
    } finally {
      setCompactionBySession((prev) => {
        if (prev[currentSession.id] === undefined) return prev
        const next = { ...prev }
        delete next[currentSession.id]
        return next
      })
      finishSessionGeneration(currentSession.id, null)
    }
  }

  /** Ask the main process to cancel the in-flight compaction for the active session; the pending
   *  promise rejects with an AbortError and the catch above restores the pre-compaction state. */
  const cancelCompaction = (): void => {
    if (activeSessionId && compactionBySession[activeSessionId] !== undefined) {
      window.api.abortCompaction(activeSessionId)
    }
  }

  const handleSendMessage = async (
    customPrompt?: string,
    customMsgId?: string,
    options: SendMessageOptions = {}
  ): Promise<boolean> => {
    const requestConfig = latestRequestConfigRef.current
    const promptToSend = customPrompt !== undefined ? customPrompt : inputVal
    const trimmedPrompt = promptToSend.trim()
    if (
      !customMsgId &&
      customPrompt === undefined &&
      attachedFiles.length === 0 &&
      trimmedPrompt.toLowerCase() === '/compact'
    ) {
      return handleCompactCurrentSession()
    }
    if (!trimmedPrompt && attachedFiles.length === 0 && !customPrompt) return false
    if (isSessionBusy(activeSessionId)) {
      const activeGeneration = activeGenerationsRef.current.get(activeSessionId)
      if (
        activeGeneration?.phase === 'finalizing' &&
        !customMsgId &&
        !options.forceBranch &&
        !options.branchSource
      ) {
        return admitPromptRef.current(promptToSend, 'queue')
      }
      return false
    }
    const effectiveRunMode = resolveEffectiveRunMode(promptToSend, runModeRef.current)

    if (!ensureApiKey(requestConfig, '请先在设置中填写 DeepSeek API Key！')) return false

    setInputVal('')

    let currentSessions = cloneSessionInSnapshot(sessionsRef.current, activeSessionId)
    const resolveResult = resolveSessionForSend(
      currentSessions,
      activeSessionId,
      draftSessionRef.current
    )
    currentSessions = resolveResult.updatedSessions
    if (resolveResult.draftSessionCleared) {
      setDraftSession(null)
    }
    const reverted = commitStagedRevert(currentSessions, resolveResult.session)
    currentSessions = reverted.sessions
    const currentSession = reverted.session

    let targetSession = currentSession
    let sourceMessageId = customMsgId
    let branchOf: { sessionId: string; messageId: string; runId?: string } | undefined
    let forkedCachePayload:
      | { sourceSessionId: string; targetSessionId: string; runIds: string[] }
      | undefined

    // 1. If we are editing, update message content and slice trailing messages
    if (customMsgId) {
      const editResult = prepareEditOrForkMutation({
        currentSession,
        promptToSend,
        msgId: customMsgId,
        forceBranch: options.forceBranch,
        branchSource: options.branchSource,
        now: Date.now()
      })

      if (editResult.isForked) {
        targetSession = editResult.targetSession
        branchOf = editResult.targetSession.branchOf
        currentSessions.unshift(editResult.targetSession)
        setActiveSessionId(editResult.targetSession.id)
        forkedCachePayload = editResult.forkedCachePayload
      } else {
        targetSession = currentSession
        if (editResult.removedRunIds && editResult.removedRunIds.length > 0) {
          const cleanup = planRemovedRunCleanup(
            currentSessions,
            currentSession,
            editResult.removedRunIds
          )
          currentSession.resources = cleanup.keptResources
          if (cleanup.cacheCleanup) {
            void window.api.clearSessionCaches(cleanup.cacheCleanup).catch(console.warn)
          }
        }
        currentSession.messages = editResult.updatedSourceSessionMessages || currentSession.messages
        currentSession.contextEpoch = getSessionContextEpoch(editResult.targetSession)
      }
    } else {
      const userMsg = createUserMessage({
        id: Date.now().toString(),
        content: promptToSend,
        files: attachedFiles
      })
      sourceMessageId = userMsg.id
      targetSession.messages.push(userMsg)
      setAttachedFiles([])
    }

    // Update session metadata
    targetSession.lastActiveTime = Date.now()
    if (
      !customMsgId &&
      targetSession.messages.length === 1 &&
      shouldAutoDeriveSessionTitle(targetSession)
    ) {
      targetSession.title = deriveSessionTitle(promptToSend, 'Chat')
    }
    if (shouldAutoDeriveSessionTitle(targetSession)) {
      targetSession.title = deriveSessionTitle(promptToSend, '聊天对话')
    }

    const reqId = createRunId()

    const assistantMsgId = (Date.now() + 1).toString()
    targetSession.messages.push(
      createAssistantPlaceholder({
        id: assistantMsgId,
        runMode: effectiveRunMode,
        runId: reqId,
        branchOf
      })
    )
    const contextEpoch = getSessionContextEpoch(targetSession)
    window.api.advanceSessionContext(targetSession.id, contextEpoch)
    beginSessionGeneration(targetSession.id, reqId, assistantMsgId)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    await persistBeforeStreaming(currentSessions, targetSession.id, reqId)

    const historyForRun = targetSession.messages.slice(0, -1)
    const apiMessages = buildApiMessages(requestConfig.systemPrompt, historyForRun)

    if (forkedCachePayload && forkedCachePayload.runIds.length > 0) {
      try {
        const copyResult = await window.api.forkSessionCaches(forkedCachePayload)
        if (!copyResult.ok) {
          console.warn('Failed to fork session caches:', forkedCachePayload)
        }
      } catch (err) {
        console.warn('Failed to fork session caches:', forkedCachePayload, err)
      }
    }

    startStreamingRun(
      reqId,
      targetSession.id,
      assistantMsgId,
      contextEpoch,
      () =>
        window.api.startChatCompletion(
          reqId,
          buildChatRunOptions({
            config: requestConfig,
            session: targetSession,
            messages: apiMessages,
            historyForCachePriority: historyForRun,
            runMode: effectiveRunMode,
            contextEpoch,
            sourceMessageId,
            assistantMessageId: assistantMsgId,
            branchOf,
            reasoningPreference: resolveReasoningPreferenceRef.current(targetSession)
          })
        ),
      (msg) => `出错了：${msg || '网络连接失败'}`
    )
    return true
  }

  const handleAdmitPrompt = async (
    prompt: string,
    mode: SessionPromptAdmissionMode
  ): Promise<boolean> => {
    const requestConfig = latestRequestConfigRef.current
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt && attachedFiles.length === 0) return false

    // When the UI has become idle between keydown and dispatch, fall back to a normal run.
    if (!isSessionBusy(activeSessionId)) {
      return handleSendMessage(prompt)
    }
    if (!ensureApiKey(requestConfig, '请先在设置中填写 DeepSeek API Key。')) return false

    let currentSessions = cloneSessionInSnapshot(sessionsRef.current, activeSessionId)
    const resolveResult = resolveSessionForSend(
      currentSessions,
      activeSessionId,
      draftSessionRef.current
    )
    currentSessions = resolveResult.updatedSessions
    if (resolveResult.draftSessionCleared) setDraftSession(null)
    const reverted = commitStagedRevert(currentSessions, resolveResult.session)
    currentSessions = reverted.sessions
    let targetSession = reverted.session

    const { sourceMessageId, assistantMessageId } = createMessagePairIds(
      currentSessions,
      Date.now()
    )
    const admissionId = createRunId('prompt-admission-')
    const userMessage = createUserMessage({
      id: sourceMessageId,
      content: prompt,
      files: attachedFiles
    })
    const assistantPlaceholder = createQueuedAssistantPlaceholder(assistantMessageId)
    const activeGeneration = activeGenerationsRef.current.get(targetSession.id)
    const activeAssistantMessageId = activeGeneration
      ? activeGeneration.assistantMessageId ||
        [...targetSession.messages].reverse().find((message) => message.role === 'assistant')?.id
      : undefined

    targetSession = appendQueuedPromptToSession(targetSession, userMessage, assistantPlaceholder)
    const contextEpoch = getSessionContextEpoch(targetSession)
    if (targetSession.messages.length === 2 && shouldAutoDeriveSessionTitle(targetSession)) {
      targetSession.title = deriveSessionTitle(prompt, 'Chat')
    }
    currentSessions = replaceSessionInSnapshot(currentSessions, targetSession)
    setSessions(currentSessions)
    sessionsRef.current = currentSessions
    await persistSessionsSnapshot(currentSessions)

    try {
      const admissionMessages = buildApiMessages(
        '',
        targetSession.messages.filter((message) => message.id !== assistantMessageId)
      ).slice(-1)
      const reasoningPreference = resolveReasoningPreferenceRef.current(targetSession)
      const result = await window.api.admitSessionPrompt({
        id: admissionId,
        sessionId: targetSession.id,
        contextEpoch,
        mode,
        runMode: resolveEffectiveRunMode(prompt, runModeRef.current),
        sourceMessageId,
        assistantMessageId,
        messages: admissionMessages,
        requestedReasoningPreference: reasoningPreference,
        effectiveReasoningPreference: reasoningPreference
      })

      if (result.disposition === 'steered') {
        const nextSessions = applySteeredAdmission(sessionsRef.current, {
          sessionId: targetSession.id,
          sourceMessageId,
          queuedAssistantMessageId: assistantMessageId,
          activeAssistantMessageId
        })
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        persistSessionsSnapshotSoon(nextSessions)
      } else if (result.disposition === 'queued') {
        const nextSessions = markQueuedPromptInSessions(sessionsRef.current, {
          admissionId,
          sessionId: targetSession.id,
          sourceMessageId,
          assistantMessageId
        })
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        persistSessionsSnapshotSoon(nextSessions)
        toast.info('消息已加入队列。')
      }

      setAttachedFiles([])
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const nextSessions = sessionsRef.current.map((session) =>
        session.id !== targetSession.id
          ? session
          : {
              ...session,
              messages: session.messages.map((item) =>
                item.id === sourceMessageId
                  ? withoutQueuedPrompt(item)
                  : item.id === assistantMessageId
                    ? markMessageAsRuntimeError(
                        withoutQueuedPrompt(item),
                        `队列提交失败：${message}`
                      )
                    : item
              )
            }
      )
      sessionsRef.current = nextSessions
      setSessions(nextSessions)
      persistSessionsSnapshotSoon(nextSessions)
      toast.error(`队列提交失败：${message}`)
      setAttachedFiles([])
      return true
    }
  }

  admitPromptRef.current = handleAdmitPrompt

  const handleCancelQueuedPrompt = async (msg: Message): Promise<void> => {
    const queued = msg.queuedPrompt
    if (!queued || cancellingQueuedPromptIdsRef.current.has(queued.admissionId)) return

    cancellingQueuedPromptIdsRef.current.add(queued.admissionId)
    setCancellingQueuedPromptIds(new Set(cancellingQueuedPromptIdsRef.current))
    try {
      const cancelled = await window.api.cancelSessionPrompt(queued.admissionId)
      if (!cancelled) {
        toast.info('该消息已经开始执行，无法再从队列取消。')
        return
      }

      const nextSessions = removeQueuedPromptFromSessions(sessionsRef.current, {
        admissionId: queued.admissionId,
        sessionId: queued.sessionId,
        sourceMessageId: msg.id,
        assistantMessageId: queued.assistantMessageId
      })
      sessionsRef.current = nextSessions
      setSessions(nextSessions)
      persistSessionsSnapshotSoon(nextSessions)
      toast.success('已取消排队消息。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`取消排队消息失败：${message}`)
    } finally {
      cancellingQueuedPromptIdsRef.current.delete(queued.admissionId)
      setCancellingQueuedPromptIds(new Set(cancellingQueuedPromptIdsRef.current))
    }
  }

  const drainNextQueuedPrompt = async (sessionId: string): Promise<void> => {
    if (!sessionId || isSessionBusy(sessionId)) return
    const requestConfig = latestRequestConfigRef.current
    if (needsApiKeyBeforeRun(requestConfig)) return

    queueDrainInProgressRef.current.add(sessionId)
    let claimedAdmissionId: string | undefined
    let registeredReqId: string | undefined
    let launched = false
    try {
      const sessionAtClaim = sessionsRef.current.find((session) => session.id === sessionId)
      if (!sessionAtClaim) return
      const contextEpoch = getSessionContextEpoch(sessionAtClaim)
      const admission = await window.api.claimNextSessionPrompt(sessionId, contextEpoch)
      if (!admission) return
      claimedAdmissionId = admission.id
      if (isSessionRunActive(sessionId)) {
        await window.api.requeueSessionPrompt(admission.id)
        claimedAdmissionId = undefined
        return
      }

      let sourceSession = sessionsRef.current.find((session) => session.id === sessionId)
      if (
        !sourceSession ||
        !admission.assistantMessageId ||
        admission.contextEpoch !== getSessionContextEpoch(sourceSession)
      ) {
        // The admission was already claimed (running); cancelClaimedSessionPrompt is the only
        // cancel that terminates a running inbox entry.
        await window.api.cancelClaimedSessionPrompt(admission.id)
        claimedAdmissionId = undefined
        return
      }

      sourceSession = materializeBackgroundPrompt(sourceSession, admission)

      const reqId = createRunId('queued-run-')
      const prepared = prepareClaimedPromptRun(
        sourceSession,
        admission.sourceMessageId,
        admission.assistantMessageId,
        reqId,
        admission.runMode
      )
      if (!prepared) {
        await window.api.cancelClaimedSessionPrompt(admission.id)
        claimedAdmissionId = undefined
        return
      }

      const nextSessions = replaceSessionInSnapshot(sessionsRef.current, prepared.session)
      sessionsRef.current = nextSessions
      setSessions(nextSessions)
      registeredReqId = reqId
      beginSessionGeneration(sessionId, reqId, prepared.assistantMessageId)
      await persistSessionsSnapshot(nextSessions)

      const apiMessages = buildApiMessages(
        requestConfig.systemPrompt,
        prepared.messagesBeforeAssistant
      )
      startStreamingRun(
        reqId,
        sessionId,
        prepared.assistantMessageId,
        contextEpoch,
        () =>
          window.api.startChatCompletion(
            reqId,
            buildChatRunOptions({
              config: requestConfig,
              session: prepared.session,
              messages: apiMessages,
              historyForCachePriority: prepared.messagesBeforeAssistant,
              runMode: admission.runMode,
              contextEpoch,
              sourceMessageId: admission.sourceMessageId,
              assistantMessageId: prepared.assistantMessageId,
              promptAdmissionId: admission.id,
              reasoningPreference:
                admission.effectiveReasoningPreference ||
                admission.requestedReasoningPreference ||
                resolveReasoningPreferenceRef.current(prepared.session)
            })
          ),
        (message) => `队列消息执行失败：${message || '网络连接失败'}`
      )
      launched = true
    } catch (error) {
      console.warn('Failed to drain queued prompt:', error)
      if (claimedAdmissionId && !launched) {
        await window.api.requeueSessionPrompt(claimedAdmissionId).catch(console.warn)
      }
      if (!launched && registeredReqId) {
        finishSessionGeneration(sessionId, registeredReqId)
      }
    } finally {
      queueDrainInProgressRef.current.delete(sessionId)
    }
  }
  drainQueuedPromptRef.current = drainNextQueuedPrompt

  flushBackgroundSubagentEventsRef.current = (): void => {
    const notifications = backgroundSubagentEventQueueRef.current
    if (notifications.length === 0) return
    backgroundSubagentEventQueueRef.current = []

    const { sessions: nextSessions, changed } = applyEpochScopedNotifications(
      sessionsRef.current,
      notifications,
      applyBackgroundSubagentEventNotification
    )
    if (!changed) return
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
  }

  useEffect(() => {
    const unsubscribe = window.api.onBackgroundSubagentEvent(
      (notification: BackgroundSubagentEventNotification): void => {
        backgroundSubagentEventQueueRef.current.push(notification)
        if (backgroundSubagentEventFrameRef.current !== null) return
        backgroundSubagentEventFrameRef.current = window.requestAnimationFrame(() => {
          backgroundSubagentEventFrameRef.current = null
          flushBackgroundSubagentEventsRef.current()
        })
      }
    )

    return () => {
      unsubscribe()
      if (backgroundSubagentEventFrameRef.current !== null) {
        window.cancelAnimationFrame(backgroundSubagentEventFrameRef.current)
        backgroundSubagentEventFrameRef.current = null
      }
      backgroundSubagentEventQueueRef.current = []
    }
  }, [sessionsRef, setSessions])

  /**
   * Merge a background result into its session and persist, honouring the context epoch.
   *
   * Held in a ref rather than closed over directly: the subscription effects re-run only when the
   * active session changes, so a plain closure would let them keep calling a stale copy.
   */
  const commitBackgroundNotificationRef = useRef<
    <T extends { sessionId: string; contextEpoch: number; disposition?: string }>(
      notification: T,
      apply: (session: Session, notification: T, activeAssistantMessageId?: string) => Session,
      persistErrorLabel: string
    ) => void
  >(() => undefined)

  commitBackgroundNotificationRef.current = <
    T extends { sessionId: string; contextEpoch: number; disposition?: string }
  >(
    notification: T,
    apply: (session: Session, notification: T, activeAssistantMessageId?: string) => Session,
    persistErrorLabel: string
  ): void => {
    const nextSessions = applyEpochScopedNotification(
      sessionsRef.current,
      notification,
      (session, item) =>
        apply(
          session,
          item,
          activeGenerationsRef.current.get(item.sessionId)?.assistantMessageId || undefined
        )
    )
    if (!nextSessions) return

    sessionsRef.current = nextSessions
    setSessions(nextSessions)
    void persistSessionsSnapshot(nextSessions).catch((error) => {
      console.warn(persistErrorLabel, error)
    })

    if (shouldDrainAfterNotification(notification, isSessionGenerating(notification.sessionId))) {
      window.setTimeout(() => {
        void drainQueuedPromptRef.current(notification.sessionId)
      }, 25)
    }
  }

  useEffect(() => {
    return window.api.onBackgroundSubagentResult(
      (notification: BackgroundSubagentResultNotification): void => {
        // Land any buffered step events before the terminal result so the timeline stays ordered.
        if (backgroundSubagentEventFrameRef.current !== null) {
          window.cancelAnimationFrame(backgroundSubagentEventFrameRef.current)
          backgroundSubagentEventFrameRef.current = null
        }
        flushBackgroundSubagentEventsRef.current()

        commitBackgroundNotificationRef.current(
          notification,
          applyBackgroundSubagentNotification,
          'Failed to persist background subagent result:'
        )
      }
    )
  }, [activeSessionId, sessionsRef, setSessions])

  useEffect(() => {
    return window.api.onBackgroundShellResult(
      (notification: BackgroundShellResultNotification): void => {
        commitBackgroundNotificationRef.current(
          notification,
          applyBackgroundShellNotification,
          'Failed to persist background shell result:'
        )
      }
    )
  }, [activeSessionId, sessionsRef, setSessions])

  useEffect(() => {
    if (!activeSessionId || generatingSessionIds.has(activeSessionId)) return
    const timer = window.setTimeout(() => {
      void drainQueuedPromptRef.current(activeSessionId)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [activeSessionId, apiKey, apiUrl, generatingSessionIds, selectedModel])

  const handleRunAgentSkill = async (skill: Skill, userInput: string): Promise<void> => {
    const requestConfig = latestRequestConfigRef.current
    if (isSessionBusy(activeSessionId)) return
    if (!ensureApiKey(requestConfig, 'Please set the DeepSeek API Key in Settings first.')) return

    setInputVal('')

    let currentSessions = cloneSessionsDeep(sessionsRef.current)
    const resolveResult = resolveSessionForSend(
      currentSessions,
      activeSessionId,
      draftSessionRef.current
    )
    currentSessions = resolveResult.updatedSessions
    if (resolveResult.draftSessionCleared) {
      setDraftSession(null)
    }
    const reverted = commitStagedRevert(currentSessions, resolveResult.session)
    currentSessions = reverted.sessions
    const currentSession = reverted.session

    const displayPrompt = `@${skill.trigger}${userInput.trim() ? ` ${userInput.trim()}` : ''}`
    const userMsg = createUserMessage({ id: Date.now().toString(), content: displayPrompt })
    currentSession.messages.push(userMsg)
    setAttachedFiles([])

    currentSession.lastActiveTime = Date.now()
    if (currentSession.messages.length === 1 && shouldAutoDeriveSessionTitle(currentSession)) {
      currentSession.title = deriveSessionTitle(displayPrompt, 'Agent Skill')
    }

    // Agent skill runs reuse the assistant message id as the run id.
    const assistantMsgId = (Date.now() + 1).toString()
    currentSession.messages.push(
      createAssistantPlaceholder({
        id: assistantMsgId,
        runMode: 'agent',
        runId: assistantMsgId
      })
    )
    const reqId = assistantMsgId
    beginSessionGeneration(currentSession.id, reqId, assistantMsgId)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    await persistBeforeStreaming(currentSessions, currentSession.id, reqId)

    const contextEpoch = getSessionContextEpoch(currentSession)
    window.api.advanceSessionContext(currentSession.id, contextEpoch)

    startStreamingRun(
      reqId,
      currentSession.id,
      assistantMsgId,
      contextEpoch,
      () =>
        window.api.startAgentSkill(
          reqId,
          buildAgentSkillRunOptions({
            config: requestConfig,
            session: currentSession,
            historyForCachePriority: currentSession.messages.slice(0, -1),
            skill,
            userInput,
            contextEpoch,
            sourceMessageId: userMsg.id,
            assistantMessageId: assistantMsgId,
            reasoningPreference: resolveReasoningPreferenceRef.current(currentSession)
          })
        ),
      (msg) => `Agent Skill failed: ${msg}`
    )
  }

  const handleStartEdit = (msg: Message): void => {
    setEditingMessageId(msg.id)
    setEditingText(msg.content)
  }

  const handleSaveEdit = (msgId: string): void => {
    const nextText = editingText
    setEditingMessageId(null)
    setTimeout(() => {
      const promiseOrVoid = handleSendMessage(nextText, msgId)
      if (promiseOrVoid instanceof Promise) {
        promiseOrVoid.catch(console.error)
      }
    }, 100)
  }

  const handleRegenerate = (msgIdx: number): void => {
    const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
    if (!currentSession) return
    const assistantMsg = currentSession.messages[msgIdx]
    const precedingUserMsg = currentSession.messages[msgIdx - 1]
    if (
      assistantMsg?.role === 'assistant' &&
      precedingUserMsg &&
      precedingUserMsg.role === 'user'
    ) {
      const promiseOrVoid = handleSendMessage(precedingUserMsg.content, precedingUserMsg.id, {
        forceBranch: msgIdx < currentSession.messages.length - 1,
        branchSource: {
          messageId: assistantMsg.id,
          ...(assistantMsg.agentRunId ? { runId: assistantMsg.agentRunId } : {})
        }
      })
      if (promiseOrVoid instanceof Promise) {
        promiseOrVoid.catch(console.error)
      }
    }
  }

  const handleResumeAgentRun = async (msgIdx: number): Promise<void> => {
    const requestConfig = latestRequestConfigRef.current
    if (isSessionBusy(activeSessionId)) return
    if (!ensureApiKey(requestConfig, 'Please set the DeepSeek API Key in Settings first.')) return

    let currentSessions = cloneSessionsDeep(sessionsRef.current)
    const found = currentSessions.find((s) => s.id === activeSessionId)
    let currentSession = found
    if (found) {
      const reverted = commitStagedRevert(currentSessions, found)
      currentSessions = reverted.sessions
      currentSession = reverted.session
    }
    const failedMsg = currentSession?.messages[msgIdx]
    const resumeFromRunId = failedMsg?.agentRunId
    if (!currentSession || !failedMsg || !resumeFromRunId) return

    setInputVal('')

    const reqId = createRunId()

    const resumeResult = prepareResumeMutation({
      currentSession,
      msgIdx,
      reqId,
      now: Date.now()
    })

    const branchOf = resumeResult.branchOf
    let targetSession = currentSession

    if (resumeResult.isHistoricalResume) {
      targetSession = resumeResult.targetSession
      currentSessions.unshift(targetSession)
      setActiveSessionId(targetSession.id)
    } else {
      const targetMsgIdx = currentSession.messages.findIndex((msg) => msg.id === failedMsg.id)
      if (targetMsgIdx === -1) {
        return
      }
      currentSession.messages = resumeResult.updatedSourceSessionMessages || currentSession.messages
      currentSession.contextEpoch = getSessionContextEpoch(resumeResult.targetSession)
    }

    const assistantMsgId = failedMsg.id
    const contextEpoch = getSessionContextEpoch(targetSession)
    window.api.advanceSessionContext(targetSession.id, contextEpoch)

    targetSession.lastActiveTime = Date.now()
    beginSessionGeneration(targetSession.id, reqId, assistantMsgId)

    if (resumeResult.forkedCachePayload && resumeResult.forkedCachePayload.runIds.length > 0) {
      void window.api.forkSessionCaches(resumeResult.forkedCachePayload).catch(console.warn)
    }

    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    await persistBeforeStreaming(currentSessions, targetSession.id, reqId)

    startStreamingRun(
      reqId,
      targetSession.id,
      assistantMsgId,
      contextEpoch,
      () =>
        window.api.startChatCompletion(
          reqId,
          buildChatRunOptions({
            config: requestConfig,
            session: targetSession,
            // Resume replays the persisted checkpoint, so no new turn is sent.
            messages: [],
            historyForCachePriority: targetSession.messages.slice(0, -1),
            runMode: 'agent',
            contextEpoch,
            sourceMessageId: failedMsg.id,
            assistantMessageId: assistantMsgId,
            branchOf,
            resume: { fromRunId: resumeFromRunId, sourceSessionId: currentSession.id },
            // Agent loop prefers the original run-manifest snapshot when resuming.
            reasoningPreference: resolveReasoningPreferenceRef.current(targetSession)
          })
        ),
      (msg) => `Agent resume failed: ${msg || 'network connection failed'}`
    )
  }

  return {
    inputVal,
    setInputVal,
    isGenerating,
    generatingSessionIds,
    activeRequestId,
    activeRequestIds,
    cancellingQueuedPromptIds,
    editingMessageId,
    setEditingMessageId,
    editingText,
    setEditingText,
    runMode,
    setRunMode,
    handleSendMessage,
    handleAdmitPrompt,
    handleCancelQueuedPrompt,
    handleRunAgentSkill,
    handleStartEdit,
    handleSaveEdit,
    handleRegenerate,
    handleResumeAgentRun,
    showHelpMessage,
    handleCompactCurrentSession,
    compaction:
      activeSessionId && compactionBySession[activeSessionId] !== undefined
        ? { sessionId: activeSessionId, startedAt: compactionBySession[activeSessionId] }
        : null,
    cancelCompaction,
    handleAbortGeneration
  }
}
