import React, { useState } from 'react'
import { ChatChunkData, Message, Session, Skill, RunMode, AgentEvent, SessionResource } from '../../../shared/types'

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

export const useChatCompletion = ({
  setSessions,
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

  // Replace a single message in the active session, keeping sessionsRef in sync.
  const updateMessageById = (
    msgId: string,
    updater: (m: Message) => Message,
    touchActiveTime = true
  ): void => {
    setSessions((prevSessions) => {
      const next = prevSessions.map((s) => {
        if (s.id !== activeSessionId) return s
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
  const persistActiveSession = (): void => {
    setTimeout(async () => {
      const finalSessions = ((await window.api.storeGet('sessions')) as Session[]) || []
      const currentActive = sessionsRef.current.find((s) => s.id === activeSessionId)
      if (currentActive) {
        currentActive.lastActiveTime = Date.now()
        const updatedSessions = finalSessions.map((s) =>
          s.id === activeSessionId ? currentActive : s
        )
        if (!updatedSessions.some((s) => s.id === activeSessionId)) {
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
    assistantMsgId: string,
    start: () => void,
    formatError: (msg: string) => string
  ): void => {
    let accumulatedText = ''
    let accumulatedReasoning = ''

    const unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
      if (data.reqId !== reqId) return

      if (data.error) {
        updateMessageById(
          assistantMsgId,
          (m) => ({ ...m, content: formatError(data.error!) }),
          false
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
        updateMessageById(assistantMsgId, (m) => ({
          ...m,
          reasoning_content: accumulatedReasoning
        }))
      }

      if (data.content) {
        accumulatedText += data.content
        updateMessageById(assistantMsgId, (m) => ({ ...m, content: accumulatedText }))
      }

      if (data.event) {
        if (data.event.type === 'resource_update') {
          const updatedResource = data.event.resource
          setSessions((prevSessions) => {
            const next = prevSessions.map((s) => {
              if (s.id !== activeSessionId) return s

              const existingResources = s.resources || []
              const resIdx = existingResources.findIndex((r) => r.id === updatedResource.id)

              let newResources: SessionResource[]
              if (resIdx !== -1) {
                const existingRes = existingResources[resIdx]

                // Merge all metadata chunks returned by the cache, not only the first one.
                const chunkMap = new Map(existingRes.chunks.map((chunk) => [chunk.id, chunk]))
                updatedResource.chunks.forEach((chunk) => {
                  chunkMap.set(chunk.id, chunk)
                })
                const newChunks = Array.from(chunkMap.values()).sort(
                  (a, b) => (a.offset ?? 0) - (b.offset ?? 0)
                )

                // Merge fetchedRanges
                const fetchedRanges = mergeResourceRanges([
                  ...(existingRes.fetchedRanges || []),
                  ...(updatedResource.fetchedRanges || [])
                ])

                const mergedRes: SessionResource = {
                  ...existingRes,
                  title: updatedResource.title || existingRes.title,
                  totalChars: updatedResource.totalChars ?? existingRes.totalChars,
                  nextOffset: updatedResource.nextOffset,
                  status: updatedResource.status,
                  summary: updatedResource.summary ?? existingRes.summary,
                  fetchedRanges,
                  chunks: newChunks,
                  updatedAt: updatedResource.updatedAt || Date.now()
                }
                newResources = [...existingResources]
                newResources[resIdx] = mergedRes
              } else {
                newResources = [...existingResources, updatedResource]
              }

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
          updateMessageById(assistantMsgId, (m) => applyAgentEventToMessage(m, data.event!))
        }
      }
    })

    const cleanup = (): void => {
      unsubscribe()
      setIsGenerating(false)
      setActiveReqId(null)
      persistActiveSession()
    }

    try {
      start()
    } catch (err) {
      const error = err as Error
      console.error(error)
      updateMessageById(
        assistantMsgId,
        (m) => ({ ...m, content: formatError(error.message) }),
        false
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
    const currentSession = currentSessions.find((s) => s.id === activeSessionId)
    if (!currentSession) {
      setIsGenerating(false)
      return
    }

    // 1. If we are editing, update message content and slice trailing messages
    if (customMsgId) {
      const idx = currentSession.messages.findIndex((m) => m.id === customMsgId)
      if (idx !== -1) {
        currentSession.messages[idx] = {
          ...currentSession.messages[idx],
          content: promptToSend
        }
        currentSession.messages = currentSession.messages.slice(0, idx + 1)
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
    const currentSession = currentSessions.find((s) => s.id === activeSessionId)
    if (!currentSession) {
      setIsGenerating(false)
      return
    }

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
    if (currentSession.messages.length === 2) {
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
