import React, { useEffect, useRef, useState } from 'react'
import {
  ContextRetentionMode,
  Message,
  ModelRuntimeConfig,
  Project,
  Session,
  Skill,
  RunMode
} from '../../../shared/types'
import { computeResourcePrune } from './useSessions'
import { startStreamingRun as startChatStreamingRun } from './chatStreaming'

// Extracted pure helper functions
import { buildApiMessages } from '../features/chat/apiMessageBuilder'
import { getCachePriorityRetainedRuns } from '../features/chat/resourceCacheCoordinator'
import {
  resolveSessionForSend,
  getProjectRunContext,
  prepareEditOrForkMutation,
  prepareResumeMutation
} from '../features/chat/sessionMutationService'

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

interface UseChatCompletionProps {
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>
  activeSessionId: string
  sessionsRef: React.MutableRefObject<Session[]>
  projects: Project[]
  apiKey: string
  apiUrl: string
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
}

export interface UseChatCompletionReturn {
  inputVal: string
  setInputVal: React.Dispatch<React.SetStateAction<string>>
  isGenerating: boolean
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>
  activeGenerationSessionId: string | null
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
  handleRunAgentSkill: (skill: Skill, userInput: string) => Promise<void>
  handleStartEdit: (msg: Message) => void
  handleSaveEdit: (msgId: string) => void
  handleRegenerate: (msgIdx: number) => void
  handleResumeAgentRun: (msgIdx: number) => void
  showHelpMessage: () => Promise<void>
  handleCompactCurrentSession: () => Promise<boolean>
  handleAbortGeneration: () => void
}

interface SendMessageOptions {
  branchSource?: { messageId: string; runId?: string }
  forceBranch?: boolean
}

const MANUAL_COMPACTION_KEEP_RECENT_MESSAGES = 6

const formatCompactionSummaryMessage = (result: {
  summary: string
  compactedCount: number
  keptCount: number
  tokenSpeed?: number
}): string =>
  [
    '### 上下文压缩摘要',
    '',
    `已使用模型总结前 ${result.compactedCount} 条历史消息，最近 ${result.keptCount} 条消息保留原文。`,
    result.tokenSpeed !== undefined ? `压缩生成速度：${result.tokenSpeed} token/s。` : '',
    '',
    result.summary
  ]
    .filter(Boolean)
    .join('\n')
export const touchSessionInSnapshot = (
  sessions: Session[],
  sessionId: string,
  timestamp: number
): Session[] =>
  sessions.map((session) =>
    session.id === sessionId ? { ...session, lastActiveTime: timestamp } : session
  )

export const useChatCompletion = ({
  setSessions,
  setActiveSessionId,
  activeSessionId,
  sessionsRef,
  projects,
  apiKey,
  apiUrl,
  selectedModel,
  modelRuntimeConfig,
  contextWindowTokens,
  contextRetentionMode,
  systemPrompt,
  setShowSettings,
  attachedFiles,
  setAttachedFiles,
  draftSession,
  setDraftSession
}: UseChatCompletionProps): UseChatCompletionReturn => {
  const [inputVal, setInputVal] = useState('')
  const draftSessionRef = useRef<Session | null>(null)
  useEffect(() => {
    draftSessionRef.current = draftSession
  }, [draftSession])
  const [isGenerating, setIsGenerating] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [activeReqId, setActiveReqId] = useState<string | null>(null)
  const [activeGenerationSessionId, setActiveGenerationSessionId] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<RunMode>('chat')

  const latestRequestConfigRef = useRef({
    apiKey,
    apiUrl,
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
    selectedModel,
    modelRuntimeConfig,
    contextWindowTokens,
    contextRetentionMode,
    systemPrompt,
    projects
  ])

  const isGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    isGeneratingRef.current = isGenerating
  }, [isGenerating])

  const setIsGeneratingLive: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
    setIsGenerating((prev) => {
      const next =
        typeof value === 'function' ? (value as (current: boolean) => boolean)(prev) : value
      isGeneratingRef.current = next
      return next
    })
  }

  // Mirror runMode in a ref so dispatch always reads the live value. handleSendMessage can be
  // captured in a stale closure — MessageBubble is memoized and its comparator ignores callback
  // props, so the onRegenerate/onSaveEdit it holds may close over an older runMode than the toggle
  // currently shows. Reading the ref (stable across renders) instead of the closed-over `runMode`
  // ensures regenerate/edit after toggling honours the current mode.
  const runModeRef = useRef(runMode)
  useEffect(() => {
    runModeRef.current = runMode
  }, [runMode])

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

  const persistSessionsSnapshot = async (snapshot: Session[]): Promise<void> => {
    await window.api.storeSet('sessions', snapshot)
  }

  const persistSessionsSnapshotSoon = (snapshot: Session[]): void => {
    void persistSessionsSnapshot(snapshot).catch((err) => {
      console.warn('Failed to persist sessions snapshot:', err)
    })
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
    start: () => void,
    formatError: (msg: string) => string
  ): void => {
    setActiveGenerationSessionId(sessionId)
    startChatStreamingRun({
      reqId,
      sessionId,
      assistantMsgId,
      start,
      formatError,
      setSessions,
      sessionsRef,
      updateMessageById,
      setIsGenerating: setIsGeneratingLive,
      setActiveReqId,
      onCleanup: () => setActiveGenerationSessionId(null),
      persistActiveSession
    })
  }

  const handleAbortGeneration = (): void => {
    if (activeReqId) {
      // Just signal the main process. It always replies with a { cancelled, done }
      // chunk, which drives cleanup() from a single source of truth
      // and preserving whatever content was already streamed.
      window.api.abortGeneration(activeReqId)
    }
  }

  const showHelpMessage = async (): Promise<void> => {
    if (!activeSessionId) return
    const helpMsg: Message = {
      id: `help-${Date.now()}`,
      role: 'assistant',
      content: `### QuickAI 快捷操作与命令

* **全局快捷键**：\`Alt + /\`（显示或隐藏）
* **快速隐藏**：\`Esc\`
* **换行**：\`Shift + Enter\`
* **发送消息**：\`Enter\`
* **窗口拖动**：按住顶部标题栏空白区域可移动窗口

#### 可用的 "/" 快捷指令
* \`/new\` - 新建空白对话
* \`/clear\` - 清空当前对话
* \`/settings\` - 打开设置面板
* \`/help\` - 显示帮助信息
* \`/model:模型名\` - 切换模型
* \`/history:会话名\` - 加载历史对话
* \`/delete:会话名\` - 删除历史对话`
    }
    const updated = sessionsRef.current.map((s) => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          messages: [...s.messages, helpMsg],
          lastActiveTime: Date.now()
        }
      }
      return s
    })
    setSessions(updated)
    sessionsRef.current = updated
    await window.api.storeSet('sessions', updated)
  }

  const handleCompactCurrentSession = async (): Promise<boolean> => {
    const requestConfig = latestRequestConfigRef.current
    if (isGeneratingRef.current) return false

    if (!requestConfig.apiKey && requestConfig.apiUrl.includes('deepseek.com')) {
      alert('请先在设置中填写 DeepSeek API Key。')
      setShowSettings(true)
      return false
    }

    const currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const currentSession = currentSessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return false

    if (currentSession.messages.length <= MANUAL_COMPACTION_KEEP_RECENT_MESSAGES + 1) {
      alert('当前对话可压缩内容不足。')
      setInputVal('')
      return true
    }

    setIsGeneratingLive(true)
    setInputVal('')
    setActiveGenerationSessionId(currentSession.id)

    const tempMsg: Message = {
      id: 'temp-compaction-placeholder',
      role: 'assistant',
      content: '正在压缩历史对话上下文，请稍候...',
      agentEvents: [
        {
          type: 'agent_step',
          stepId: 'step-compaction',
          step: 1,
          maxSteps: 1,
          title: '上下文压缩',
          message: '正在分析对话历史并生成压缩摘要...',
          status: 'running'
        }
      ]
    }

    currentSession.messages.push(tempMsg)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions

    try {
      const result = await window.api.compactContext({
        apiUrl: requestConfig.apiUrl,
        apiKey: requestConfig.apiKey,
        model: requestConfig.selectedModel,
        modelRuntime: requestConfig.modelRuntimeConfig,
        messages: currentSession.messages.filter((m) => m.id !== 'temp-compaction-placeholder'),
        keepRecentMessages: MANUAL_COMPACTION_KEEP_RECENT_MESSAGES,
        systemPrompt: requestConfig.systemPrompt
      })

      // Remove the temporary placeholder before inserting the summaryMsg
      currentSession.messages = currentSession.messages.filter(
        (m) => m.id !== 'temp-compaction-placeholder'
      )

      const compactedMessages = currentSession.messages.slice(0, result.compactedCount)
      const keptMessages = currentSession.messages.slice(result.compactedCount)
      const summaryMsg: Message = {
        id: `compact-${Date.now()}`,
        role: 'assistant',
        content: formatCompactionSummaryMessage(result),
        isCompactionSummary: true,
        ...(result.tokenSpeed !== undefined ? { tokenSpeed: result.tokenSpeed } : {})
      }

      currentSession.messages = [...compactedMessages, summaryMsg, ...keptMessages]
      currentSession.lastActiveTime = Date.now()
      setSessions([...currentSessions])
      sessionsRef.current = currentSessions
      persistSessionsSnapshotSoon(currentSessions)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '上下文压缩失败')
      alert(`上下文压缩失败：${message}`)
      return false
    } finally {
      currentSession.messages = currentSession.messages.filter(
        (m) => m.id !== 'temp-compaction-placeholder'
      )
      setIsGeneratingLive(false)
      setActiveGenerationSessionId(null)
      setSessions([...currentSessions])
      sessionsRef.current = currentSessions
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
    if (isGeneratingRef.current) return false
    const effectiveRunMode: RunMode = /^\s*@\S+/.test(promptToSend) ? 'agent' : runModeRef.current

    // Verify key
    if (!requestConfig.apiKey && requestConfig.apiUrl.includes('deepseek.com')) {
      alert('请先在设置中填写 DeepSeek API Key！')
      setShowSettings(true)
      return false
    }

    setIsGeneratingLive(true)
    setInputVal('')

    let currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const resolveResult = resolveSessionForSend(
      currentSessions,
      activeSessionId,
      draftSessionRef.current
    )
    const currentSession = resolveResult.session
    currentSessions = resolveResult.updatedSessions
    if (resolveResult.draftSessionCleared) {
      setDraftSession(null)
    }
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
          const others = currentSessions.filter((s) => s.id !== currentSession.id)
          const { keptResources, deletableIds } = computeResourcePrune(
            currentSession,
            others,
            editResult.removedRunIds
          )
          currentSession.resources = keptResources
          void window.api
            .clearSessionCaches({
              sessionIds: [],
              resourceIds: deletableIds,
              partialActions: [{ sessionId: currentSession.id, runIds: editResult.removedRunIds }]
            })
            .catch(console.warn)
        }
        currentSession.messages = editResult.updatedSourceSessionMessages || currentSession.messages
      }
    } else {
      // Normal message send
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: promptToSend,
        files: [...attachedFiles]
      }
      sourceMessageId = userMsg.id
      targetSession.messages.push(userMsg)
      setAttachedFiles([])
    }

    // Update session metadata
    targetSession.lastActiveTime = Date.now()
    if (!customMsgId && targetSession.messages.length === 1) {
      targetSession.title = promptToSend.substring(0, 15) || 'Chat'
    }
    if (targetSession.title === '新对话') {
      targetSession.title = promptToSend.substring(0, 15) || '聊天对话'
    }

    // Construct request ID
    const reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    setActiveReqId(reqId)

    // Create placeholder for AI response
    const assistantMsgId = (Date.now() + 1).toString()
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning_content: '',
      ...(effectiveRunMode === 'agent'
        ? { agentRunId: reqId, agentRunIds: [reqId], agentEvents: [] }
        : {}),
      ...(branchOf ? { isBranchFork: true, forkedFrom: branchOf } : {})
    }
    targetSession.messages.push(assistantMsg)
    setActiveGenerationSessionId(targetSession.id)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    persistSessionsSnapshotSoon(currentSessions)

    // Load full messages block
    const apiMessages = buildApiMessages(
      requestConfig.systemPrompt,
      targetSession.messages.slice(0, -1)
    )

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
      () =>
        window.api.startChatCompletion(reqId, {
          apiUrl: requestConfig.apiUrl,
          apiKey: requestConfig.apiKey,
          model: requestConfig.selectedModel,
          modelRuntime: requestConfig.modelRuntimeConfig,
          contextWindowTokens: requestConfig.contextWindowTokens,
          contextRetentionMode: requestConfig.contextRetentionMode,
          cachePriorityRetainedRuns: getCachePriorityRetainedRuns(
            targetSession.messages.slice(0, -1),
            requestConfig.contextRetentionMode,
            requestConfig.systemPrompt
          ),
          messages: apiMessages,
          runMode: effectiveRunMode,
          resources: targetSession.resources,
          sessionId: targetSession.id,
          ...getProjectRunContext(targetSession, requestConfig.projects),
          sourceMessageId,
          assistantMessageId: assistantMsgId,
          branchOf
        }),
      (msg) => `出错了：${msg || '网络连接失败'}`
    )
    return true
  }

  const handleRunAgentSkill = async (skill: Skill, userInput: string): Promise<void> => {
    const requestConfig = latestRequestConfigRef.current
    if (isGeneratingRef.current) return

    if (!requestConfig.apiKey && requestConfig.apiUrl.includes('deepseek.com')) {
      alert('Please set the DeepSeek API Key in Settings first.')
      setShowSettings(true)
      return
    }

    setIsGeneratingLive(true)
    setInputVal('')

    let currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const resolveResult = resolveSessionForSend(
      currentSessions,
      activeSessionId,
      draftSessionRef.current
    )
    const currentSession = resolveResult.session
    currentSessions = resolveResult.updatedSessions
    if (resolveResult.draftSessionCleared) {
      setDraftSession(null)
    }

    const displayPrompt = `@${skill.trigger}${userInput.trim() ? ` ${userInput.trim()}` : ''}`
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: displayPrompt,
      files: []
    }
    currentSession.messages.push(userMsg)
    setAttachedFiles([])

    currentSession.lastActiveTime = Date.now()
    if (currentSession.messages.length === 1) {
      currentSession.title = displayPrompt.substring(0, 15) || 'Agent Skill'
    }

    const assistantMsgId = (Date.now() + 1).toString()
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning_content: '',
      agentRunId: assistantMsgId,
      agentRunIds: [assistantMsgId],
      agentEvents: []
    }
    currentSession.messages.push(assistantMsg)
    setActiveGenerationSessionId(currentSession.id)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    persistSessionsSnapshotSoon(currentSessions)

    const reqId = assistantMsgId
    setActiveReqId(reqId)

    startStreamingRun(
      reqId,
      currentSession.id,
      assistantMsgId,
      () =>
        window.api.startAgentSkill(reqId, {
          apiUrl: requestConfig.apiUrl,
          apiKey: requestConfig.apiKey,
          model: requestConfig.selectedModel,
          modelRuntime: requestConfig.modelRuntimeConfig,
          contextWindowTokens: requestConfig.contextWindowTokens,
          contextRetentionMode: requestConfig.contextRetentionMode,
          cachePriorityRetainedRuns: getCachePriorityRetainedRuns(
            currentSession.messages.slice(0, -1),
            requestConfig.contextRetentionMode,
            requestConfig.systemPrompt
          ),
          systemPrompt: requestConfig.systemPrompt,
          skill,
          userInput,
          resources: currentSession.resources,
          sessionId: currentSession.id,
          ...getProjectRunContext(currentSession, requestConfig.projects),
          sourceMessageId: userMsg.id,
          assistantMessageId: assistantMsgId
        }),
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

  const handleResumeAgentRun = (msgIdx: number): void => {
    const requestConfig = latestRequestConfigRef.current
    if (isGeneratingRef.current) return
    if (!requestConfig.apiKey && requestConfig.apiUrl.includes('deepseek.com')) {
      alert('Please set the DeepSeek API Key in Settings first.')
      setShowSettings(true)
      return
    }

    const currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const currentSession = currentSessions.find((s) => s.id === activeSessionId)
    const failedMsg = currentSession?.messages[msgIdx]
    const resumeFromRunId = failedMsg?.agentRunId
    if (!currentSession || !resumeFromRunId) return

    setIsGeneratingLive(true)
    setInputVal('')

    const reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    setActiveReqId(reqId)

    const resumeResult = prepareResumeMutation({
      currentSession,
      msgIdx,
      reqId,
      now: Date.now()
    })

    const branchOf = resumeResult.branchOf
    const isHistoricalResume = resumeResult.isHistoricalResume
    let targetSession = currentSession

    if (isHistoricalResume) {
      targetSession = resumeResult.targetSession
      currentSessions.unshift(targetSession)
      setActiveSessionId(targetSession.id)
    } else {
      const targetMsgIdx = currentSession.messages.findIndex((msg) => msg.id === failedMsg.id)
      if (targetMsgIdx === -1) {
        setIsGeneratingLive(false)
        setActiveReqId(null)
        return
      }
      currentSession.messages = resumeResult.updatedSourceSessionMessages || currentSession.messages
    }

    const assistantMsgId = failedMsg.id

    targetSession.lastActiveTime = Date.now()
    setActiveGenerationSessionId(targetSession.id)

    if (resumeResult.forkedCachePayload && resumeResult.forkedCachePayload.runIds.length > 0) {
      void window.api.forkSessionCaches(resumeResult.forkedCachePayload).catch(console.warn)
    }

    setSessions([...currentSessions])
    sessionsRef.current = currentSessions
    persistSessionsSnapshotSoon(currentSessions)

    startStreamingRun(
      reqId,
      targetSession.id,
      assistantMsgId,
      () =>
        window.api.startChatCompletion(reqId, {
          apiUrl: requestConfig.apiUrl,
          apiKey: requestConfig.apiKey,
          model: requestConfig.selectedModel,
          modelRuntime: requestConfig.modelRuntimeConfig,
          contextWindowTokens: requestConfig.contextWindowTokens,
          contextRetentionMode: requestConfig.contextRetentionMode,
          cachePriorityRetainedRuns: getCachePriorityRetainedRuns(
            targetSession.messages.slice(0, -1),
            requestConfig.contextRetentionMode,
            requestConfig.systemPrompt
          ),
          messages: [],
          runMode: 'agent',
          resources: targetSession.resources,
          sessionId: targetSession.id,
          ...getProjectRunContext(targetSession, requestConfig.projects),
          resumeFromRunId,
          resumeSourceSessionId: currentSession.id,
          sourceMessageId: failedMsg.id,
          assistantMessageId: assistantMsgId,
          branchOf
        }),
      (msg) => `Agent resume failed: ${msg || 'network connection failed'}`
    )
  }

  return {
    inputVal,
    setInputVal,
    isGenerating,
    setIsGenerating: setIsGeneratingLive,
    activeGenerationSessionId,
    editingMessageId,
    setEditingMessageId,
    editingText,
    setEditingText,
    runMode,
    setRunMode,
    handleSendMessage,
    handleRunAgentSkill,
    handleStartEdit,
    handleSaveEdit,
    handleRegenerate,
    handleResumeAgentRun,
    showHelpMessage,
    handleCompactCurrentSession,
    handleAbortGeneration
  }
}
