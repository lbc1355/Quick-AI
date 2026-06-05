import { useState } from 'react'
import { Message, Session } from '../../../shared/types'

interface UseChatCompletionProps {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  activeSessionId: string
  sessionsRef: React.MutableRefObject<Session[]>
  apiKey: string
  apiUrl: string
  selectedModel: string
  systemPrompt: string
  setShowSettings: (show: boolean) => void
  attachedFiles: Array<{ name: string; content: string; type: string }>
  setAttachedFiles: React.Dispatch<React.SetStateAction<Array<{ name: string; content: string; type: string }>>>
}

export const useChatCompletion = ({
  sessions,
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
}: UseChatCompletionProps) => {
  const [inputVal, setInputVal] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const showHelpMessage = async () => {
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
    const updated = sessions.map((s) => {
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
    await window.api.storeSet('sessions', updated)
  }

  const handleSendMessage = async (customPrompt?: string, customMsgId?: string) => {
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

    let currentSessions = [...sessions]
    let currentSession = currentSessions.find((s) => s.id === activeSessionId)
    if (!currentSession) {
      setIsGenerating(false)
      return
    }

    // 1. If we are editing, delete/slice trailing messages
    if (customMsgId) {
      const idx = currentSession.messages.findIndex((m) => m.id === customMsgId)
      if (idx !== -1) {
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
      reasoning_content: ''
    }
    currentSession.messages.push(assistantMsg)
    setSessions([...currentSessions])

    // Load full messages block
    const apiMessages: any[] = []
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt })
    }

    currentSession.messages.slice(0, -1).forEach((msg) => {
      let content: any = msg.content
      if (msg.files && msg.files.length > 0) {
        const textParts = [msg.content]
        const images: any[] = []
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
          content = [
            { type: 'text', text: textParts.join('\n') },
            ...images
          ]
        } else {
          content = textParts.join('\n')
        }
      }
      apiMessages.push({ role: msg.role, content })
    })

    // Construct request ID
    const reqId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    let accumulatedText = ''
    let accumulatedReasoning = ''

    const unsubscribe = window.api.onChatChunk((data) => {
      if (data.reqId !== reqId) return

      if (data.error) {
        setSessions((prevSessions) =>
          prevSessions.map((s) => {
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
        setSessions((prevSessions) =>
          prevSessions.map((s) => {
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
        )
      }

      if (data.content) {
        accumulatedText += data.content
        setSessions((prevSessions) =>
          prevSessions.map((s) => {
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
        )
      }
    })

    const cleanup = () => {
      unsubscribe()
      setIsGenerating(false)
      // Save sessions
      setTimeout(async () => {
        const finalSessions = (await window.api.storeGet('sessions') as Session[]) || []
        const currentActive = sessionsRef.current.find((s) => s.id === activeSessionId)
        if (currentActive) {
          currentActive.lastActiveTime = Date.now()
          const updatedSessions = finalSessions.map((s) => (s.id === activeSessionId ? currentActive : s))
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
        messages: apiMessages
      })
    } catch (err: any) {
      console.error(err)
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return { ...m, content: `⚠️ 出错了：${err.message || '启动请求失败'}` }
                }
                return m
              })
            }
          }
          return s
        })
      )
      cleanup()
    }
  }

  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id)
    setEditingText(msg.content)
  }

  const handleSaveEdit = (msgId: string) => {
    setSessions((prevSessions) =>
      prevSessions.map((s) => {
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
    )
    setEditingMessageId(null)
    setTimeout(() => {
      handleSendMessage(editingText, msgId)
    }, 100)
  }

  const handleRegenerate = (msgIdx: number) => {
    const currentSession = sessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return
    const precedingUserMsg = currentSession.messages[msgIdx - 1]
    if (precedingUserMsg && precedingUserMsg.role === 'user') {
      handleSendMessage(precedingUserMsg.content, precedingUserMsg.id)
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
    handleSendMessage,
    handleStartEdit,
    handleSaveEdit,
    handleRegenerate,
    showHelpMessage
  }
}
