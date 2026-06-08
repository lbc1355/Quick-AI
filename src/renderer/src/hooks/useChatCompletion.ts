import React, { useState } from 'react'
import {
  ChatChunkData,
  Message,
  Session,
  Skill,
  RunMode,
  AgentEvent,
  SessionResource
} from '../../../shared/types'
import { computeResourcePrune } from './useSessions'

const mergeResourceRanges = (
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> => {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const current = sorted[i]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push(current)
    }
  }

  return merged
}

/**
 * Merge an incoming resource_update into the existing session resource (or create it), stamping the
 * producing run id into `runIds`. Pure — exported for testing. The runIds set is what later lets an
 * edit/regenerate prune resources whose every producing turn was removed.
 */
export const mergeResourceUpdate = (
  existing: SessionResource | undefined,
  incoming: SessionResource,
  reqId: string
): SessionResource => {
  if (!existing) {
    return { ...incoming, runIds: [reqId] }
  }

  // Merge all metadata chunks returned by the cache, not only the first one.
  const chunkMap = new Map(existing.chunks.map((chunk) => [chunk.id, chunk]))
  incoming.chunks.forEach((chunk) => {
    chunkMap.set(chunk.id, chunk)
  })
  const newChunks = Array.from(chunkMap.values()).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))

  const fetchedRanges = mergeResourceRanges([
    ...(existing.fetchedRanges || []),
    ...(incoming.fetchedRanges || [])
  ])

  const runIds = Array.from(new Set([...(existing.runIds ?? []), reqId]))

  return {
    ...existing,
    title: incoming.title || existing.title,
    totalChars: incoming.totalChars ?? existing.totalChars,
    nextOffset: incoming.nextOffset,
    status: incoming.status,
    summary: incoming.summary ?? existing.summary,
    fetchedRanges,
    runIds,
    chunks: newChunks,
    updatedAt: incoming.updatedAt || Date.now()
  }
}

const applyAgentEventToMessage = (m: Message, newEvent: AgentEvent): Message => {
  const currentEvents = m.agentEvents || []
  const updatedEvents = [...currentEvents]

  if (newEvent.type === 'tool_call') {
    const existingIdx = updatedEvents.findIndex(
      (e) => e.type === 'tool_call' && e.callId === newEvent.callId
    )
    if (existingIdx !== -1) {
      const existingEvent = updatedEvents[existingIdx]
      if (existingEvent.type === 'tool_call') {
        updatedEvents[existingIdx] = {
          ...existingEvent,
          permissionState: newEvent.permissionState
        }
      }
    } else {
      updatedEvents.push(newEvent)
    }
  } else if (updatedEvents.length > 0) {
    const lastEvent = updatedEvents[updatedEvents.length - 1]
    if (lastEvent.type === 'reasoning' && newEvent.type === 'reasoning') {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: lastEvent.content + newEvent.content
      }
    } else if (lastEvent.type === 'final' && newEvent.type === 'final') {
      updatedEvents[updatedEvents.length - 1] = {
        ...lastEvent,
        content: lastEvent.content + newEvent.content
      }
    } else {
      updatedEvents.push(newEvent)
    }
  } else {
    updatedEvents.push(newEvent)
  }

  let newContent = m.content
  let newReasoning = m.reasoning_content

  if (newEvent.type === 'reasoning') {
    newReasoning = (newReasoning || '') + newEvent.content
  } else if (newEvent.type === 'final') {
    newContent = (newContent || '') + newEvent.content
  }

  return {
    ...m,
    agentEvents: updatedEvents,
    content: newContent,
    reasoning_content: newReasoning
  }
}

interface UseChatCompletionProps {
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>
  activeSessionId: string
  sessionsRef: React.MutableRefObject<Session[]>
  apiKey: string
  apiUrl: string
  selectedModel: string
  systemPrompt: string
  setShowSettings: (show: boolean) => void
  attachedFiles: Array<{ name: string; content: string; type: string }>
  setAttachedFiles: React.Dispatch<
    React.SetStateAction<Array<{ name: string; content: string; type: string }>>
  >
}

export interface UseChatCompletionReturn {
  inputVal: string
  setInputVal: React.Dispatch<React.SetStateAction<string>>
  isGenerating: boolean
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>
  editingMessageId: string | null
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>
  editingText: string
  setEditingText: React.Dispatch<React.SetStateAction<string>>
  runMode: RunMode
  setRunMode: React.Dispatch<React.SetStateAction<RunMode>>
  handleSendMessage: (customPrompt?: string, customMsgId?: string) => Promise<void>
  handleRunAgentSkill: (skill: Skill, userInput: string) => Promise<void>
  handleStartEdit: (msg: Message) => void
  handleSaveEdit: (msgId: string) => void
  handleRegenerate: (msgIdx: number) => void
  showHelpMessage: () => Promise<void>
  handleAbortGeneration: () => void
}

interface ApiMessage {
  role: string
  content:
    | string
    | Array<{
        type: string
        text?: string
        image_url?: { url: string }
      }>
}

const SESSION_SEND_TIMEOUT_MS = 5 * 60 * 1000

export const useChatCompletion = ({
  setSessions,
  setActiveSessionId,
  activeSessionId,
  sessionsRef,
  apiKey,
  apiUrl,
  selectedModel,
  systemPrompt,
  setShowSettings,
  attachedFiles,
  setAttachedFiles
}: UseChatCompletionProps): UseChatCompletionReturn => {
  const [inputVal, setInputVal] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [activeReqId, setActiveReqId] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<RunMode>('chat')

  const resolveSessionForSend = (
    currentSessions: Session[],
    allowTimeoutSplit: boolean
  ): Session => {
    const now = Date.now()
    let currentSession = currentSessions.find((s) => s.id === activeSessionId)

    if (!currentSession) {
      currentSession = {
        id: now.toString(),
        title: 'New chat',
        messages: [],
        lastActiveTime: now
      }
      currentSessions.unshift(currentSession)
      setActiveSessionId(currentSession.id)
      return currentSession
    }

    const lastActive = currentSession.lastActiveTime || Number(currentSession.id)
    const shouldSplitForTimeout =
      allowTimeoutSplit &&
      currentSession.messages.length > 0 &&
      Number.isFinite(lastActive) &&
      now - lastActive > SESSION_SEND_TIMEOUT_MS

    if (!shouldSplitForTimeout) return currentSession

    const newSession: Session = {
      id: now.toString(),
      title: 'New chat',
      messages: [],
      lastActiveTime: now
    }
    currentSessions.unshift(newSession)
    setActiveSessionId(newSession.id)
    return newSession
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

  // Persist the active session after a run finishes, merging into the latest stored state.
  const persistActiveSession = (sessionId = activeSessionId): void => {
    setTimeout(async () => {
      const finalSessions = ((await window.api.storeGet('sessions')) as Session[]) || []
      const currentActive = sessionsRef.current.find((s) => s.id === sessionId)
      if (currentActive) {
        currentActive.lastActiveTime = Date.now()
        const updatedSessions = finalSessions.map((s) => (s.id === sessionId ? currentActive : s))
        if (!updatedSessions.some((s) => s.id === sessionId)) {
          updatedSessions.push(currentActive)
        }
        await window.api.storeSet('sessions', updatedSessions)
      }
    }, 300)
  }

  // Shared streaming pipeline for both chat and agent-skill runs: subscribes to the
  // chat-chunk channel, funnels deltas into the placeholder assistant message, and
  // tears down on done/error. `start` kicks off the underlying IPC request.
  const startStreamingRun = (
    reqId: string,
    sessionId: string,
    assistantMsgId: string,
    start: () => void,
    formatError: (msg: string) => string
  ): void => {
    let accumulatedText = ''
    let accumulatedReasoning = ''

    const unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
      if (data.reqId !== reqId) return

      if (data.error) {
        const errorText = formatError(data.error!)
        updateMessageById(
          assistantMsgId,
          (m) => {
            const currentEvents = m.agentEvents || []
            const hasEvents = currentEvents.length > 0
            return {
              ...m,
              content: errorText,
              agentEvents: hasEvents
                ? [...currentEvents, { type: 'final', content: errorText }]
                : currentEvents
            }
          },
          false,
          sessionId
        )
        cleanup()
        return
      }

      if (data.done) {
        cleanup()
        return
      }

      if (data.reasoningContent) {
        accumulatedReasoning += data.reasoningContent
        updateMessageById(
          assistantMsgId,
          (m) => ({
            ...m,
            reasoning_content: accumulatedReasoning
          }),
          true,
          sessionId
        )
      }

      if (data.content) {
        accumulatedText += data.content
        updateMessageById(
          assistantMsgId,
          (m) => ({ ...m, content: accumulatedText }),
          true,
          sessionId
        )
      }

      if (data.event) {
        if (data.event.type === 'resource_update') {
          const updatedResource = data.event.resource
          setSessions((prevSessions) => {
            const next = prevSessions.map((s) => {
              if (s.id !== sessionId) return s

              const existingResources = s.resources || []
              const resIdx = existingResources.findIndex((r) => r.id === updatedResource.id)
              const merged = mergeResourceUpdate(
                resIdx !== -1 ? existingResources[resIdx] : undefined,
                updatedResource,
                reqId
              )
              const newResources =
                resIdx !== -1
                  ? existingResources.map((r, i) => (i === resIdx ? merged : r))
                  : [...existingResources, merged]

              return {
                ...s,
                resources: newResources,
                lastActiveTime: Date.now()
              }
            })
            sessionsRef.current = next
            return next
          })
        } else {
          updateMessageById(
            assistantMsgId,
            (m) => applyAgentEventToMessage(m, data.event!),
            true,
            sessionId
          )
        }
      }
    })

    const cleanup = (): void => {
      unsubscribe()
      setIsGenerating(false)
      setActiveReqId(null)
      persistActiveSession(sessionId)
    }

    try {
      start()
    } catch (err) {
      const error = err as Error
      console.error(error)
      const errorText = formatError(error.message)
      updateMessageById(
        assistantMsgId,
        (m) => {
          const currentEvents = m.agentEvents || []
          const hasEvents = currentEvents.length > 0
          return {
            ...m,
            content: errorText,
            agentEvents: hasEvents
              ? [...currentEvents, { type: 'final', content: errorText }]
              : currentEvents
          }
        },
        false,
        sessionId
      )
      cleanup()
    }
  }

  const handleAbortGeneration = (): void => {
    if (activeReqId) {
      // Just signal the main process. It always replies with a { cancelled, done }
      // chunk, which drives cleanup() — keeping teardown on a single source of truth
      // and preserving whatever content was already streamed.
      window.api.abortGeneration(activeReqId)
    }
  }

  const showHelpMessage = async (): Promise<void> => {
    if (!activeSessionId) return
    const helpMsg: Message = {
      id: `help-${Date.now()}`,
      role: 'assistant',
      content: `### 💡 QuickAI 快捷操作与命令指南
      
* 🔑 **全局快捷键**：\`Alt + /\` (瞬间召唤/隐藏)
* ❌ **快速隐藏**：\`Esc\`
* ↩️ **换行**：\`Shift + Enter\`
* 🚀 **发送消息**：\`Enter\`
* ⚙️ **窗口拖动**：鼠标按住顶部标题栏空白区域可自由移动窗口

#### 🛠️ 可用的 "/" 快捷指令：
* 🆕 \`/new\` - 新建空白对话
* 🧹 \`/clear\` - 清空当前对话的所有记录
* ⚙️ \`/settings\` - 打开设置面板配置 API Key 与模型
* ℹ️ \`/help\` - 显示本帮助指引信息
* 🔄 \`/model:模型名\` - 快速点选并切换大模型
* 🕒 \`/history:会话名\` - 快捷加载以往历史对话
* ❌ \`/delete:会话名\` - 删除历史对话会话`
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

  const handleSendMessage = async (customPrompt?: string, customMsgId?: string): Promise<void> => {
    const promptToSend = customPrompt !== undefined ? customPrompt : inputVal
    if (!promptToSend.trim() && attachedFiles.length === 0 && !customPrompt) return
    if (isGenerating) return

    // Verify key
    if (!apiKey && apiUrl.includes('deepseek.com')) {
      alert('请先在设置中填写 DeepSeek API Key！')
      setShowSettings(true)
      return
    }

    setIsGenerating(true)
    setInputVal('')

    const currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const currentSession = resolveSessionForSend(currentSessions, !customMsgId)

    // 1. If we are editing, update message content and slice trailing messages
    if (customMsgId) {
      const idx = currentSession.messages.findIndex((m) => m.id === customMsgId)
      if (idx !== -1) {
        // Runs whose turns are about to be sliced away: clean up their cached resources/actions so
        // the operation history stays consistent with the dialogue after the edit/regenerate.
        const removedRunIds = currentSession.messages
          .slice(idx + 1)
          .filter((m) => m.role === 'assistant' && m.agentRunId)
          .map((m) => m.agentRunId as string)

        currentSession.messages[idx] = {
          ...currentSession.messages[idx],
          content: promptToSend
        }
        currentSession.messages = currentSession.messages.slice(0, idx + 1)

        if (removedRunIds.length > 0) {
          const others = currentSessions.filter((s) => s.id !== currentSession.id)
          const { keptResources, deletableIds } = computeResourcePrune(
            currentSession,
            others,
            removedRunIds
          )
          currentSession.resources = keptResources
          void window.api
            .clearSessionCaches({
              sessionIds: [],
              resourceIds: deletableIds,
              partialActions: [{ sessionId: currentSession.id, runIds: removedRunIds }]
            })
            .catch(console.warn)
        }
      }
    } else {
      // Normal message send
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: promptToSend,
        files: [...attachedFiles]
      }
      currentSession.messages.push(userMsg)
      setAttachedFiles([])
    }

    // Update session metadata
    currentSession.lastActiveTime = Date.now()
    if (!customMsgId && currentSession.messages.length === 1) {
      currentSession.title = promptToSend.substring(0, 15) || 'Chat'
    }
    if (currentSession.title === '新对话') {
      currentSession.title = promptToSend.substring(0, 15) || '聊天对话'
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
      ...(runMode === 'agent' ? { agentRunId: reqId, agentEvents: [] } : {})
    }
    currentSession.messages.push(assistantMsg)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions

    // Load full messages block
    const apiMessages: ApiMessage[] = []
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt })
    }

    currentSession.messages.slice(0, -1).forEach((msg) => {
      let content:
        | string
        | Array<{
            type: string
            text?: string
            image_url?: { url: string }
          }> = msg.content

      if (msg.files && msg.files.length > 0) {
        const textParts = [msg.content]
        const images: Array<{ type: 'image_url'; image_url: { url: string } }> = []
        msg.files.forEach((f) => {
          if (f.type === 'image') {
            images.push({
              type: 'image_url',
              image_url: { url: f.content }
            })
          } else {
            textParts.push(`\n[参考文件: ${f.name}]\n${f.content}`)
          }
        })

        if (images.length > 0) {
          content = [{ type: 'text', text: textParts.join('\n') }, ...images]
        } else {
          content = textParts.join('\n')
        }
      }
      apiMessages.push({ role: msg.role, content })
    })

    startStreamingRun(
      reqId,
      currentSession.id,
      assistantMsgId,
      () =>
        window.api.startChatCompletion(reqId, {
          apiUrl,
          apiKey,
          model: selectedModel,
          messages: apiMessages,
          runMode,
          resources: currentSession.resources,
          sessionId: currentSession.id
        }),
      (msg) => `⚠️ 出错了：${msg || '网络连接失败'}`
    )
  }

  const handleRunAgentSkill = async (skill: Skill, userInput: string): Promise<void> => {
    if (isGenerating) return

    if (!apiKey && apiUrl.includes('deepseek.com')) {
      alert('Please set the DeepSeek API Key in Settings first.')
      setShowSettings(true)
      return
    }

    setIsGenerating(true)
    setInputVal('')

    const currentSessions: Session[] = sessionsRef.current.map((s) => ({
      ...s,
      messages: s.messages.map((m) => ({ ...m }))
    }))
    const currentSession = resolveSessionForSend(currentSessions, true)

    const displayPrompt = `/${skill.trigger}${userInput.trim() ? ` ${userInput.trim()}` : ''}`
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
      agentEvents: []
    }
    currentSession.messages.push(assistantMsg)
    setSessions([...currentSessions])
    sessionsRef.current = currentSessions

    const reqId = assistantMsgId
    setActiveReqId(reqId)

    startStreamingRun(
      reqId,
      currentSession.id,
      assistantMsgId,
      () =>
        window.api.startAgentSkill(reqId, {
          apiUrl,
          apiKey,
          model: selectedModel,
          systemPrompt,
          skill,
          userInput,
          resources: currentSession.resources,
          sessionId: currentSession.id
        }),
      (msg) => `Agent Skill failed: ${msg}`
    )
  }

  const handleStartEdit = (msg: Message): void => {
    setEditingMessageId(msg.id)
    setEditingText(msg.content)
  }

  const handleSaveEdit = (msgId: string): void => {
    const nextSessions = sessionsRef.current.map((s) => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id === msgId) {
              return { ...m, content: editingText }
            }
            return m
          }),
          lastActiveTime: Date.now()
        }
      }
      return s
    })
    setSessions(nextSessions)
    sessionsRef.current = nextSessions
    setEditingMessageId(null)
    setTimeout(() => {
      const promiseOrVoid = handleSendMessage(editingText, msgId)
      if (promiseOrVoid instanceof Promise) {
        promiseOrVoid.catch(console.error)
      }
    }, 100)
  }

  const handleRegenerate = (msgIdx: number): void => {
    const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
    if (!currentSession) return
    const precedingUserMsg = currentSession.messages[msgIdx - 1]
    if (precedingUserMsg && precedingUserMsg.role === 'user') {
      const promiseOrVoid = handleSendMessage(precedingUserMsg.content, precedingUserMsg.id)
      if (promiseOrVoid instanceof Promise) {
        promiseOrVoid.catch(console.error)
      }
    }
  }

  return {
    inputVal,
    setInputVal,
    isGenerating,
    setIsGenerating,
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
    showHelpMessage,
    handleAbortGeneration
  }
}
