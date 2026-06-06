import React, { useState } from 'react'
import { ChatChunkData, Message, Session, Skill, RunMode, AgentEvent } from '../../../shared/types'

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

  const handleAbortGeneration = (): void => {
    if (activeReqId) {
      window.api.abortGeneration(activeReqId)
      setIsGenerating(false)
      setActiveReqId(null)
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

    // Create placeholder for AI response
    const assistantMsgId = (Date.now() + 1).toString()
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning_content: '',
      ...(runMode === 'agent' ? { agentRunId: assistantMsgId, agentEvents: [] } : {})
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

    // Construct request ID
    const reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    setActiveReqId(reqId)
    let accumulatedText = ''
    let accumulatedReasoning = ''

    const unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
      if (data.reqId !== reqId) return

      if (data.error) {
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, content: `⚠️ 出错了：${data.error || '网络连接失败'}` }
                  }
                  return m
                })
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
        cleanup()
        return
      }

      if (data.done) {
        cleanup()
        return
      }

      if (data.reasoningContent) {
        accumulatedReasoning += data.reasoningContent
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, reasoning_content: accumulatedReasoning }
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }

      if (data.content) {
        accumulatedText += data.content
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, content: accumulatedText }
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }

      if (data.event) {
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return applyAgentEventToMessage(m, data.event!)
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }
    })

    const cleanup = (): void => {
      unsubscribe()
      setIsGenerating(false)
      setActiveReqId(null)
      // Save sessions
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

    try {
      window.api.startChatCompletion(reqId, {
        apiUrl,
        apiKey,
        model: selectedModel,
        messages: apiMessages,
        runMode
      })
    } catch (err) {
      const error = err as Error
      console.error(error)
      setSessions((prevSessions) => {
        const next = prevSessions.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return { ...m, content: `⚠️ 出错了：${error.message || '启动请求失败'}` }
                }
                return m
              })
            }
          }
          return s
        })
        sessionsRef.current = next
        return next
      })
      cleanup()
    }
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
    let accumulatedText = ''
    let accumulatedReasoning = ''

    const unsubscribe = window.api.onChatChunk((data: ChatChunkData): void => {
      if (data.reqId !== reqId) return

      if (data.error) {
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, content: `Agent Skill failed: ${data.error}` }
                  }
                  return m
                })
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
        cleanup()
        return
      }

      if (data.done) {
        cleanup()
        return
      }

      if (data.event) {
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return applyAgentEventToMessage(m, data.event!)
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }

      if (data.reasoningContent) {
        accumulatedReasoning += data.reasoningContent
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, reasoning_content: accumulatedReasoning }
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }

      if (data.content) {
        accumulatedText += data.content
        setSessions((prevSessions) => {
          const next = prevSessions.map((s) => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id === assistantMsgId) {
                    return { ...m, content: accumulatedText }
                  }
                  return m
                }),
                lastActiveTime: Date.now()
              }
            }
            return s
          })
          sessionsRef.current = next
          return next
        })
      }
    })

    const cleanup = (): void => {
      unsubscribe()
      setIsGenerating(false)
      setActiveReqId(null)
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

    try {
      window.api.startAgentSkill(reqId, {
        apiUrl,
        apiKey,
        model: selectedModel,
        systemPrompt,
        skill,
        userInput
      })
    } catch (err) {
      const error = err as Error
      console.error(error)
      setSessions((prevSessions) => {
        const next = prevSessions.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return { ...m, content: `Agent Skill start failed: ${error.message}` }
                }
                return m
              })
            }
          }
          return s
        })
        sessionsRef.current = next
        return next
      })
      cleanup()
    }
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
