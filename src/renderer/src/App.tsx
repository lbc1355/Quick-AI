import React, { useState, useEffect, useRef } from 'react'
import {
  MessageSquare,
  Plus,
  Trash2,
  Settings,
  Send,
  Paperclip,
  X,
  Terminal,
  RefreshCw,
  Edit,
  Sparkles
} from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  files?: Array<{ name: string; content: string; type: string }>
}

interface Session {
  id: string
  title: string
  messages: Message[]
}

interface AppSettings {
  apiKey: string
  model: string
  systemPrompt: string
  autoHideOnBlur: boolean
}

interface Skill {
  id: string
  name: string
  trigger: string
  prompt: string
}

function App(): React.JSX.Element {
  // Navigation
  const [showSettings, setShowSettings] = useState(false)

  // Settings state
  const [apiKey, setApiKey] = useState('')
  const [selectedModel, setSelectedModel] = useState('deepseek-chat')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [autoHideOnBlur, setAutoHideOnBlur] = useState(true)
  const [appStorePath, setAppStorePath] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Chat Data state
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [inputVal, setInputVal] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  // Drag and Drop & Files state
  const [dragActive, setDragActive] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; content: string; type: string }>>([])

  // Editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([])
  const [filteredSkills, setFilteredSkills] = useState<Skill[]>([])
  const [selectedSkillIdx, setSelectedSkillIdx] = useState(0)

  // Refs for scrolling and textarea
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load configuration and data on startup
  useEffect(() => {
    const initData = async () => {
      // Settings
      const savedSettings = await window.api.storeGet('settings') as AppSettings
      if (savedSettings) {
        setApiKey(savedSettings.apiKey || '')
        setSelectedModel(savedSettings.model || 'deepseek-chat')
        setSystemPrompt(savedSettings.systemPrompt || '')
        setAutoHideOnBlur(savedSettings.autoHideOnBlur !== false)
      }

      // App metadata
      const info = await window.api.getAppInfo()
      setAppStorePath(info.storePath)

      // Sessions
      const savedSessions = (await window.api.storeGet('sessions') as Session[]) || []
      setSessions(savedSessions)
      if (savedSessions.length > 0) {
        setActiveSessionId(savedSessions[0].id)
      } else {
        // Create initial session if none exist
        const defaultSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: []
        }
        const updated = [defaultSession]
        setSessions(updated)
        setActiveSessionId(defaultSession.id)
        await window.api.storeSet('sessions', updated)
      }

      // Skills
      const savedSkills = (await window.api.storeGet('skills') as Skill[]) || []
      setSkills(savedSkills)
    }

    initData()
  }, [])

  // Auto-scroll when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sessions, activeSessionId, isGenerating])

  // Focus textarea when window opens
  useEffect(() => {
    if (!showSettings) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [showSettings, activeSessionId])

  // Trigger escape key listener to hide window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isGenerating) {
        window.api.hideWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isGenerating])

  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Save settings
  const handleSaveSettings = async () => {
    const settingsObj: AppSettings = {
      apiKey,
      model: selectedModel,
      systemPrompt,
      autoHideOnBlur
    }
    await window.api.storeSet('settings', settingsObj)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2000)
  }

  // Create new session
  const handleNewSession = async () => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新对话',
      messages: []
    }
    const updated = [newSession, ...sessions]
    setSessions(updated)
    setActiveSessionId(newSession.id)
    await window.api.storeSet('sessions', updated)
    setShowSettings(false)
  }

  // Delete session
  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const filtered = sessions.filter((s) => s.id !== id)
    let updated = filtered
    
    if (filtered.length === 0) {
      const defaultSession = {
        id: Date.now().toString(),
        title: '新对话',
        messages: []
      }
      updated = [defaultSession]
    }

    setSessions(updated)
    if (activeSessionId === id || filtered.length === 0) {
      setActiveSessionId(updated[0].id)
    }
    await window.api.storeSet('sessions', updated)
  }

  // Clear current conversation messages
  const handleClearCurrentSession = async () => {
    if (!activeSessionId) return
    const updated = sessions.map((s) => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [], title: '新对话' }
      }
      return s
    })
    setSessions(updated)
    await window.api.storeSet('sessions', updated)
  }

  // File Picker
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(processFile)
    }
  }

  // Clipboard Paste Image
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          processFile(file)
        }
      }
    }
  }

  // Drag & Drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      Array.from(e.dataTransfer.files).forEach(processFile)
    }
  }

  const processFile = (file: File) => {
    const reader = new FileReader()
    if (file.type.startsWith('image/')) {
      reader.onload = (e) => {
        if (e.target?.result) {
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: e.target!.result as string, // base64 URI
              type: 'image'
            }
          ])
        }
      }
      reader.readAsDataURL(file)
    } else {
      // Treat as plain text
      reader.onload = (e) => {
        if (e.target?.result) {
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: e.target!.result as string,
              type: 'text'
            }
          ])
        }
      }
      reader.readAsText(file)
    }
  }

  const handleRemoveFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  // Skills input logic
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputVal(val)

    // Check for `/` trigger
    if (val.startsWith('/')) {
      const searchTrigger = val.slice(1).toLowerCase()
      const matching = skills.filter((s) => s.trigger.toLowerCase().startsWith(searchTrigger))
      setFilteredSkills(matching)
      setSelectedSkillIdx((prev) => Math.min(prev, matching.length - 1))
    } else {
      setFilteredSkills([])
    }
  }

  const triggerSkill = (skill: Skill) => {
    setInputVal(skill.prompt)
    setFilteredSkills([])
    textareaRef.current?.focus()
  }

  // Keyboard navigation inside prompt input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate skills list if open
    if (filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSkillIdx((prev) => (prev + 1) % filteredSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSkillIdx((prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        triggerSkill(filteredSkills[selectedSkillIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setFilteredSkills([])
        return
      }
    }

    // Submit prompt on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Core messaging completion sender
  const handleSendMessage = async (customPrompt?: string, customMsgId?: string) => {
    const promptToSend = customPrompt !== undefined ? customPrompt : inputVal
    if (!promptToSend.trim() && attachedFiles.length === 0 && !customPrompt) return
    if (isGenerating) return

    // Verify key
    if (!apiKey) {
      alert('请先在设置中填写 DeepSeek API Key！')
      setShowSettings(true)
      return
    }

    setIsGenerating(true)
    setInputVal('')

    let currentSessions = [...sessions]
    let currentSession = currentSessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return

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

    // Update session title if it was default
    if (currentSession.title === '新对话') {
      currentSession.title = promptToSend.substring(0, 15) || '聊天对话'
    }

    // Create placeholder for AI response
    const assistantMsgId = (Date.now() + 1).toString()
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: ''
    }
    currentSession.messages.push(assistantMsg)
    setSessions([...currentSessions])

    // Load full messages block (including custom system prompt)
    const apiMessages: any[] = []
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt })
    }

    // Process previous messages for API payload
    currentSession.messages.slice(0, -1).forEach((msg) => {
      let content: any = msg.content
      // If there are files/images attached, construct multimodal payload if image, or explain files
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

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          stream: true
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API Error: ${response.status} - ${errText || response.statusText}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let accumulatedText = ''

      if (!reader) throw new Error('Failed to get readable stream reader')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleanLine = line.trim()
          if (!cleanLine) continue
          if (cleanLine === 'data: [DONE]') break

          if (cleanLine.startsWith('data: ')) {
            try {
              const json = JSON.parse(cleanLine.substring(6))
              const content = json.choices[0]?.delta?.content || ''
              if (content) {
                accumulatedText += content
                // Live update sessions state
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
                        })
                      }
                    }
                    return s
                  })
                )
              }
            } catch (e) {
              // Parse error on incomplete JSON chunks
            }
          }
        }
      }
    } catch (error: any) {
      console.error(error)
      setSessions((prevSessions) =>
        prevSessions.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return { ...m, content: `⚠️ 出错了：${error.message || '网络连接失败'}` }
                }
                return m
              })
            }
          }
          return s
        })
      )
    } finally {
      setIsGenerating(false)
      // Save full sessions payload back to FileStore
      setTimeout(async () => {
        const finalSessions = (await window.api.storeGet('sessions') as Session[]) || []
        const currentActive = sessions.find((s) => s.id === activeSessionId)
        if (currentActive) {
          const updatedSessions = finalSessions.map((s) => (s.id === activeSessionId ? currentActive : s))
          if (!updatedSessions.some((s) => s.id === activeSessionId)) {
            updatedSessions.push(currentActive)
          }
          await window.api.storeSet('sessions', updatedSessions)
        }
      }, 300)
    }
  }

  // Edit previous user message and resend
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
            })
          }
        }
        return s
      })
    )
    setEditingMessageId(null)
    // Re-send the prompt starting from this message ID
    setTimeout(() => {
      handleSendMessage(editingText, msgId)
    }, 100)
  }

  // Regenerate response
  const handleRegenerate = (msgIdx: number) => {
    const currentSession = sessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return
    // Retrieve the prompt immediately preceding this assistant message
    const precedingUserMsg = currentSession.messages[msgIdx - 1]
    if (precedingUserMsg && precedingUserMsg.role === 'user') {
      // Trigger a resend branching from the user prompt
      handleSendMessage(precedingUserMsg.content, precedingUserMsg.id)
    }
  }

  // Formatting message elements
  const renderMessageContent = (text: string) => {
    if (!text) return null
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n([\s\S]*?)```/)
        const lang = match ? match[1] : ''
        const code = match ? match[2] : part.slice(3, -3)
        return (
          <div key={idx} className="code-block-container" style={{ margin: '8px 0', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 12px', fontSize: '11.5px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#9ca3af', display: 'flex', justifyContent: 'space-between', userSelect: 'none' }}>
              <span>{lang || 'code'}</span>
              <span style={{ cursor: 'pointer', color: '#3b82f6' }} onClick={() => navigator.clipboard.writeText(code)}>复制</span>
            </div>
            <pre style={{ margin: 0, padding: '10px', overflowX: 'auto', background: 'rgba(10,10,12,0.45)', fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
              <code>{code}</code>
            </pre>
          </div>
        )
      } else {
        const inlineParts = part.split(/(`[^`\n]+`)/g)
        return (
          <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
            {inlineParts.map((subPart, subIdx) => {
              if (subPart.startsWith('`') && subPart.endsWith('`')) {
                return (
                  <code key={subIdx} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#f43f5e' }}>
                    {subPart.slice(1, -1)}
                  </code>
                )
              }
              return subPart
            })}
          </span>
        )
      }
    })
  }

  return (
    <div className="app-container" onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}>
      {/* Sidebar Panel */}
      <div className="sidebar">
        <div>
          <div className="sidebar-header">
            <div className="logo-section">
              <Sparkles className="logo-icon" />
              <span className="logo-text">QuickAI</span>
            </div>
            <button className="new-chat-btn" onClick={handleNewSession} title="创建新对话">
              <Plus size={16} />
            </button>
          </div>
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id} className={`session-item ${activeSessionId === s.id && !showSettings ? 'active' : ''}`} onClick={() => {
                setActiveSessionId(s.id)
                setShowSettings(false)
              }}>
                <MessageSquare size={14} style={{ marginRight: '8px', flexShrink: 0 }} />
                <span className="session-title">{s.title}</span>
                <button className="delete-session-btn" onClick={(e) => handleDeleteSession(e, s.id)} title="删除对话">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className={`footer-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(true)}>
            <Settings size={14} />
            <span>应用设置</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      {showSettings ? (
        <div className="settings-container">
          <div className="settings-header">QuickAI 设置</div>
          
          <div className="settings-group">
            <label className="settings-label">DeepSeek API Key</label>
            <input type="password" className="settings-input" placeholder="输入您的 api.deepseek.com Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>

          <div className="settings-group">
            <label className="settings-label">默认模型 (Model)</label>
            <select className="settings-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="deepseek-chat">deepseek-chat (常规/编程)</option>
              <option value="deepseek-reasoner">deepseek-reasoner (深度思考/R1)</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">系统预设提示词 (System Prompt)</label>
            <textarea className="settings-input" style={{ resize: 'vertical', minHeight: '80px' }} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
          </div>

          <div className="settings-group" style={{ flexDirection: 'row', alignItems: 'center', marginTop: '6px' }}>
            <label className="settings-checkbox-container">
              <input type="checkbox" className="settings-checkbox" checked={autoHideOnBlur} onChange={(e) => setAutoHideOnBlur(e.target.checked)} />
              <span>失焦时自动隐藏聊天窗口 (类似于 Spotlight)</span>
            </label>
          </div>

          <div className="settings-group" style={{ marginTop: '10px' }}>
            <label className="settings-label">本地数据存储路径</label>
            <input type="text" className="settings-input" style={{ opacity: 0.6, fontSize: '11px' }} value={appStorePath} readOnly disabled />
          </div>

          <button className="settings-save-btn" onClick={handleSaveSettings}>保存配置</button>
          {saveSuccess && <div className="settings-save-msg">✓ 配置保存成功！</div>}
        </div>
      ) : (
        <div className="chat-area">
          {/* Top Navbar */}
          <div className="chat-header">
            <div className="chat-model-info">
              <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
              <span className="model-name">{selectedModel}</span>
            </div>
            <div className="chat-header-actions">
              <button className="header-action-btn" onClick={() => window.api.toggleDevTools()} title="开发者控制台">
                <Terminal size={14} />
              </button>
              <button className="header-action-btn" onClick={handleClearCurrentSession} title="清空对话历史">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Messages Stream Container */}
          <div className="messages-container">
            {activeSession && activeSession.messages.length === 0 ? (
              <div className="empty-state">
                <Sparkles size={36} style={{ color: 'rgba(255,255,255,0.1)' }} />
                <div className="empty-title">输入您的第一个问题</div>
                <div className="empty-desc">按 Alt+/ 组合键可以在任何界面快速显示或隐藏窗口。输入 / 可以触发快捷命令技能。</div>
              </div>
            ) : (
              activeSession?.messages.map((msg, idx) => (
                <div key={msg.id} className={`message-bubble ${msg.role}`}>
                  <div className={`avatar ${msg.role}`}>
                    {msg.role === 'user' ? 'U' : 'AI'}
                  </div>
                  <div className="message-content-wrapper">
                    {editingMessageId === msg.id ? (
                      <div className="message-edit-container">
                        <textarea className="message-edit-textarea" value={editingText} onChange={(e) => setEditingText(e.target.value)} />
                        <div className="message-edit-actions">
                          <button className="edit-btn cancel" onClick={() => setEditingMessageId(null)}>取消</button>
                          <button className="edit-btn save" onClick={() => handleSaveEdit(msg.id)}>保存并重发</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="message-text">
                          {/* Attachments within user bubbles */}
                          {msg.files && msg.files.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              {msg.files.map((f, fileIdx) => (
                                <div key={fileIdx} style={{ fontSize: '11px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Paperclip size={10} />
                                  <span>{f.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {renderMessageContent(msg.content)}
                        </div>

                        {/* Hover Actions */}
                        {!isGenerating && (
                          <div className="message-actions" style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            {msg.role === 'user' ? (
                              <button className="msg-action-btn" onClick={() => handleStartEdit(msg)}>
                                <Edit size={10} />
                                <span>编辑</span>
                              </button>
                            ) : (
                              <button className="msg-action-btn" onClick={() => handleRegenerate(idx)}>
                                <RefreshCw size={10} />
                                <span>重新生成</span>
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Attached files preview list */}
          {attachedFiles.length > 0 && (
            <div style={{ padding: '0 16px', background: 'rgba(15, 15, 18, 0.4)' }}>
              <div className="file-preview-list">
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="file-preview-card">
                    <Paperclip size={12} />
                    <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    <button className="remove-file-btn" onClick={() => handleRemoveFile(idx)}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt input with skills overlay */}
          <div className="chat-input-section">
            {filteredSkills.length > 0 && (
              <div className="skills-menu">
                {filteredSkills.map((skill, idx) => (
                  <div key={skill.id} className={`skills-item ${selectedSkillIdx === idx ? 'selected' : ''}`} onClick={() => triggerSkill(skill)}>
                    <span className="skills-name">{skill.name}</span>
                    <span className="skills-trigger">/{skill.trigger}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="input-container">
              <label htmlFor="file-input" className="input-action-btn" title="上传文件 (支持拖拽/粘贴图片)" style={{ cursor: 'pointer' }}>
                <Paperclip size={16} />
                <input id="file-input" type="file" style={{ display: 'none' }} multiple onChange={handleFileChange} />
              </label>
              <textarea ref={textareaRef} className="chat-input" placeholder="输入您的问题... (Esc 隐藏, Shift+Enter 换行, / 命令快捷词)" value={inputVal} onChange={handleInputChange} onKeyDown={handleInputKeyDown} onPaste={handlePaste} rows={1} />
              <div className="chat-actions">
                <button className="input-action-btn send" onClick={() => handleSendMessage()} disabled={isGenerating || (!inputVal.trim() && attachedFiles.length === 0)} title="发送消息">
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drag & Drop Visual Overlay */}
      {dragActive && (
        <div className="drag-overlay">
          <Paperclip size={48} style={{ color: 'var(--color-primary)' }} />
          <div className="drag-text">拖拽文件到此处以上传</div>
        </div>
      )}
    </div>
  )
}

export default App
