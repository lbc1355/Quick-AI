import React, { useState, useEffect, useRef } from 'react'
import {
  Settings,
  Send,
  Paperclip,
  X,
  Terminal,
  RefreshCw,
  Edit,
  Sparkles,
  Trash2,
  Undo2,
  Plus,
  Minus
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
  lastActiveTime?: number
}

interface AppSettings {
  apiKey: string
  apiUrl: string
  model: string
  modelsList: string[]
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
  const [apiUrl, setApiUrl] = useState('https://api.deepseek.com/v1')
  const [selectedModel, setSelectedModel] = useState('deepseek-chat')
  const [modelsList, setModelsList] = useState<string[]>(['deepseek-chat', 'deepseek-reasoner'])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [autoHideOnBlur, setAutoHideOnBlur] = useState(true)
  const [appStorePath, setAppStorePath] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Model Management inputs state
  const [manualModelInput, setManualModelInput] = useState('')
  const [fetchModelsUrl, setFetchModelsUrl] = useState('https://api.deepseek.com/v1/models')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [showModelsModal, setShowModelsModal] = useState(false)

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

  // Skills & History Autocomplete state
  const [skills, setSkills] = useState<Skill[]>([])
  const [autocompleteItems, setAutocompleteItems] = useState<any[]>([])
  const [selectedItemIdx, setSelectedItemIdx] = useState(0)

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
        const loadedApiUrl = savedSettings.apiUrl || 'https://api.deepseek.com/v1'
        setApiUrl(loadedApiUrl)
        setSelectedModel(savedSettings.model || 'deepseek-chat')
        setModelsList(savedSettings.modelsList || ['deepseek-chat', 'deepseek-reasoner'])
        setSystemPrompt(savedSettings.systemPrompt || '')
        setAutoHideOnBlur(savedSettings.autoHideOnBlur !== false)
        setFetchModelsUrl(`${loadedApiUrl.replace(/\/$/, '')}/models`)
      }

      // App metadata
      const info = await window.api.getAppInfo()
      setAppStorePath(info.storePath)

      // Sessions
      const savedSessions = (await window.api.storeGet('sessions') as Session[]) || []
      setSessions(savedSessions)
      
      // Skills
      const savedSkills = (await window.api.storeGet('skills') as Skill[]) || []
      setSkills(savedSkills)

      // Setup initial session
      if (savedSessions.length > 0) {
        // Find most recently active session
        const sorted = [...savedSessions].sort((a, b) => {
          const tA = a.lastActiveTime || Number(a.id)
          const tB = b.lastActiveTime || Number(b.id)
          return tB - tA
        })
        setActiveSessionId(sorted[0].id)
        
        // Initial timeout check
        checkSessionTimeout(sorted[0].id, savedSessions)
      } else {
        const defaultSession: Session = {
          id: Date.now().toString(),
          title: '新对话',
          messages: [],
          lastActiveTime: Date.now()
        }
        const updated = [defaultSession]
        setSessions(updated)
        setActiveSessionId(defaultSession.id)
        await window.api.storeSet('sessions', updated)
      }
    }

    initData()
  }, [])

  // Update fetch models URL when API URL changes
  const handleApiUrlChange = (newUrl: string) => {
    setApiUrl(newUrl)
    setFetchModelsUrl(`${newUrl.replace(/\/$/, '')}/models`)
  }

  // Listen to window summon (focus/show) event from Main Process
  useEffect(() => {
    const handleWindowShown = () => {
      checkSessionTimeout(activeSessionId, sessions)
    }

    // Register event listener
    window.electron.ipcRenderer.on('window-shown', handleWindowShown)
    
    return () => {
      window.electron.ipcRenderer.removeAllListeners('window-shown')
    }
  }, [activeSessionId, sessions])

  // Auto-scroll when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sessions, activeSessionId, isGenerating])

  // Focus textarea when UI toggles
  useEffect(() => {
    if (!showSettings) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [showSettings, activeSessionId])

  // Trigger escape key listener to hide window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isGenerating && !showModelsModal) {
        window.api.hideWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isGenerating, showModelsModal])

  // Timeout Check: Create a new empty session if the idle time exceeds 5 minutes
  const checkSessionTimeout = async (currentActiveId: string, currentSessions: Session[]) => {
    if (currentSessions.length === 0 || !currentActiveId) return

    const activeSess = currentSessions.find((s) => s.id === currentActiveId)
    if (!activeSess) return

    // If the active session is empty, do nothing
    if (activeSess.messages.length === 0) return

    const lastActive = activeSess.lastActiveTime || Number(activeSess.id)
    const elapsed = Date.now() - lastActive
    const fiveMinutes = 5 * 60 * 1000

    if (elapsed > fiveMinutes) {
      // Create new session
      const newSession: Session = {
        id: Date.now().toString(),
        title: '新对话',
        messages: [],
        lastActiveTime: Date.now()
      }
      const updated = [newSession, ...currentSessions]
      setSessions(updated)
      setActiveSessionId(newSession.id)
      await window.api.storeSet('sessions', updated)
    } else {
      // Within 5 minutes, reset its active timer
      activeSess.lastActiveTime = Date.now()
      const updated = currentSessions.map((s) => (s.id === currentActiveId ? activeSess : s))
      setSessions(updated)
      await window.api.storeSet('sessions', updated)
    }
  }

  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Save settings
  const handleSaveSettings = async () => {
    const settingsObj: AppSettings = {
      apiKey,
      apiUrl,
      model: selectedModel,
      modelsList,
      systemPrompt,
      autoHideOnBlur
    }
    await window.api.storeSet('settings', settingsObj)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2000)
  }

  // Create new session manually (via UI button)
  const handleNewSession = async () => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [],
      lastActiveTime: Date.now()
    }
    const updated = [newSession, ...sessions]
    setSessions(updated)
    setActiveSessionId(newSession.id)
    await window.api.storeSet('sessions', updated)
    setShowSettings(false)
  }

  // Clear current conversation messages
  const handleClearCurrentSession = async () => {
    if (!activeSessionId) return
    const updated = sessions.map((s) => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [], title: '新对话', lastActiveTime: Date.now() }
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

  // Autocomplete change: skills + session histories
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputVal(val)

    if (val.startsWith('/')) {
      const search = val.slice(1).toLowerCase()
      
      // Skills
      const matchingSkills = skills
        .filter((s) => s.trigger.toLowerCase().startsWith(search))
        .map((s) => ({
          id: s.id,
          name: s.name,
          trigger: `/${s.trigger}`,
          prompt: s.prompt,
          isSession: false
        }))
      
      // Session histories (exclude active one and empty ones)
      const matchingSessions = sessions
        .filter((s) => s.id !== activeSessionId && s.messages.length > 0)
        .filter((s) => s.title.toLowerCase().includes(search))
        .map((s) => ({
          id: s.id,
          name: s.title,
          trigger: `/history:${s.id}`,
          prompt: '',
          isSession: true
        }))

      const combined = [...matchingSkills, ...matchingSessions]
      setAutocompleteItems(combined)
      setSelectedItemIdx((prev) => Math.min(prev, combined.length - 1))
    } else {
      setAutocompleteItems([])
    }
  }

  const triggerAutocompleteItem = (item: any) => {
    if (item.isSession) {
      // Switch conversation
      setActiveSessionId(item.id)
      setShowSettings(false)
      setAutocompleteItems([])
      setInputVal('')
    } else {
      // Injects prompt skill
      setInputVal(item.prompt)
      setAutocompleteItems([])
    }
    textareaRef.current?.focus()
  }

  // Keyboard navigation inside prompt input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedItemIdx((prev) => (prev + 1) % autocompleteItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedItemIdx((prev) => (prev - 1 + autocompleteItems.length) % autocompleteItems.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        triggerAutocompleteItem(autocompleteItems[selectedItemIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAutocompleteItems([])
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
    if (!apiKey && apiUrl.includes('deepseek.com')) {
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
      content: ''
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

    // Construct full URL dynamically
    const completionsUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`

    try {
      const response = await fetch(completionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
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
                        }),
                        lastActiveTime: Date.now()
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
      // Save sessions
      setTimeout(async () => {
        const finalSessions = (await window.api.storeGet('sessions') as Session[]) || []
        const currentActive = sessions.find((s) => s.id === activeSessionId)
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

  // Regenerate response
  const handleRegenerate = (msgIdx: number) => {
    const currentSession = sessions.find((s) => s.id === activeSessionId)
    if (!currentSession) return
    const precedingUserMsg = currentSession.messages[msgIdx - 1]
    if (precedingUserMsg && precedingUserMsg.role === 'user') {
      handleSendMessage(precedingUserMsg.content, precedingUserMsg.id)
    }
  }

  // Fetch models list from URL
  const handleFetchModels = async () => {
    if (!fetchModelsUrl.trim()) return
    setIsFetchingModels(true)
    try {
      const response = await fetch(fetchModelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        }
      })

      if (!response.ok) {
        throw new Error(`获取失败：${response.status} ${response.statusText}`)
      }

      const json = await response.json()
      let ids: string[] = []
      
      if (json.data && Array.isArray(json.data)) {
        ids = json.data.map((m: any) => m.id)
      } else if (json.models && Array.isArray(json.models)) {
        ids = json.models.map((m: any) => m.name || m.model)
      } else if (Array.isArray(json)) {
        ids = json.map((m: any) => typeof m === 'string' ? m : (m.id || m.name))
      }

      if (ids.length === 0) {
        alert('未获取到任何模型 ID，请检查接口返回格式！')
        return
      }

      setFetchedModels(ids)
      setShowModelsModal(true)
    } catch (e: any) {
      console.error(e)
      alert(`获取模型出错：${e.message || '网络连接异常'}`)
    } finally {
      setIsFetchingModels(false)
    }
  }

  // Manually add model ID
  const handleAddManualModel = () => {
    const modelId = manualModelInput.trim()
    if (!modelId) return
    if (modelsList.includes(modelId)) {
      alert('模型已存在于列表中！')
      return
    }
    const updated = [...modelsList, modelId]
    setModelsList(updated)
    setSelectedModel(modelId)
    setManualModelInput('')
  }

  // Toggle dynamic model add/remove
  const handleToggleModelSelection = (modelId: string) => {
    if (modelsList.includes(modelId)) {
      if (modelsList.length <= 1) {
        alert('必须保留至少一个可用模型！')
        return
      }
      const updated = modelsList.filter((m) => m !== modelId)
      setModelsList(updated)
      if (selectedModel === modelId) {
        setSelectedModel(updated[0])
      }
    } else {
      const updated = [...modelsList, modelId]
      setModelsList(updated)
    }
  }

  // Remove a model from configuration page directly
  const handleRemoveModelDirectly = (modelId: string) => {
    if (modelsList.length <= 1) {
      alert('必须保留至少一个可用模型！')
      return
    }
    const updated = modelsList.filter((m) => m !== modelId)
    setModelsList(updated)
    if (selectedModel === modelId) {
      setSelectedModel(updated[0])
    }
  }

  // Custom text formatter
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
        const formattedText = part.split(/(`[^`\n]+`)/g)
        return (
          <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
            {formattedText.map((subPart, subIdx) => {
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

  // Check if current active session is a clean "new session" with no message history
  const isNewSessionEmpty = activeSession && activeSession.messages.length === 0

  return (
    <div className="app-container" onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}>
      {/* Draggable Top Dragbar */}
      <div className="drag-header">
        <div className="drag-header-left">
          <Sparkles className="logo-icon" size={16} />
          <span className="logo-text">QuickAI</span>
          <div className="chat-model-info" style={{ marginLeft: '12px' }}>
            <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
            <span className="model-name" style={{ fontSize: '12px', color: '#9ca3af' }}>{selectedModel}</span>
          </div>
        </div>
        <div className="drag-header-right">
          {showSettings ? (
            <button className="header-action-btn" onClick={() => setShowSettings(false)} title="返回聊天">
              <Undo2 size={14} />
            </button>
          ) : (
            <>
              <button className="header-action-btn" onClick={handleNewSession} title="新建对话">
                <Plus size={14} />
              </button>
              <button className="header-action-btn" onClick={handleClearCurrentSession} title="清空历史">
                <Trash2 size={14} />
              </button>
              <button className="header-action-btn" onClick={() => window.api.toggleDevTools()} title="开发者工具">
                <Terminal size={14} />
              </button>
              <button className="header-action-btn" onClick={() => setShowSettings(true)} title="应用设置">
                <Settings size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {showSettings ? (
        <div className="settings-container">
          <div className="settings-header">QuickAI 设置</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div className="settings-group">
                <label className="settings-label">API Key</label>
                <input type="password" className="settings-input" placeholder="输入您的 API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>

              <div className="settings-group">
                <label className="settings-label">API 基础网址 (URL Base)</label>
                <input type="text" className="settings-input" placeholder="https://api.deepseek.com/v1" value={apiUrl} onChange={(e) => handleApiUrlChange(e.target.value)} />
              </div>

              <div className="settings-group">
                <label className="settings-label">当前选用模型 (Model)</label>
                <select className="settings-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  {modelsList.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="settings-group">
                <label className="settings-label">系统预设提示词 (System Prompt)</label>
                <textarea className="settings-input" style={{ resize: 'vertical', minHeight: '60px', fontSize: '12px' }} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
              </div>
            </div>

            {/* Model Management panel */}
            <div>
              <div className="settings-group" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '10px' }}>
                <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#60a5fa' }}>模型列表管理</label>
                
                {/* Manual configuration mode */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <input type="text" className="settings-input" style={{ flex: 1, height: '30px', padding: '4px 8px', fontSize: '12px' }} placeholder="手动添加模型 ID (例: gpt-4o)" value={manualModelInput} onChange={(e) => setManualModelInput(e.target.value)} />
                  <button className="settings-save-btn" style={{ margin: 0, padding: '4px 10px', height: '30px', borderRadius: '6px' }} onClick={handleAddManualModel}>
                    <Plus size={14} />
                  </button>
                </div>

                {/* Fetch from URL mode */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
                  <input type="text" className="settings-input" style={{ flex: 1, height: '30px', padding: '4px 8px', fontSize: '11px' }} placeholder="从网址获取模型列表" value={fetchModelsUrl} onChange={(e) => setFetchModelsUrl(e.target.value)} />
                  <button className="settings-save-btn" style={{ margin: 0, padding: '4px 8px', height: '30px', borderRadius: '6px', fontSize: '11.5px', whiteSpace: 'nowrap' }} onClick={handleFetchModels} disabled={isFetchingModels}>
                    {isFetchingModels ? '获取中..' : '获取模型'}
                  </button>
                </div>

                {/* Current Models list with direct remove */}
                <div style={{ marginTop: '10px' }}>
                  <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 'bold' }}>已加入的候选模型：</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', maxHeight: '100px', overflowY: 'auto' }}>
                    {modelsList.map((m) => (
                      <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px' }}>
                        <span>{m}</span>
                        <button style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center' }} onClick={() => handleRemoveModelDirectly(m)} title="移出列表">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-group" style={{ flexDirection: 'row', alignItems: 'center', marginTop: '10px' }}>
                <label className="settings-checkbox-container">
                  <input type="checkbox" className="settings-checkbox" checked={autoHideOnBlur} onChange={(e) => setAutoHideOnBlur(e.target.checked)} />
                  <span>失焦时自动隐藏聊天窗口 (类似于 Spotlight)</span>
                </label>
              </div>

              <div className="settings-group">
                <label className="settings-label" style={{ fontSize: '11.5px' }}>本地数据存储路径</label>
                <input type="text" className="settings-input" style={{ opacity: 0.5, fontSize: '10.5px', padding: '6px' }} value={appStorePath} readOnly disabled />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
            <button className="settings-save-btn" onClick={handleSaveSettings}>保存配置</button>
            {saveSuccess && <div className="settings-save-msg" style={{ margin: 0 }}>✓ 配置保存成功！</div>}
          </div>
        </div>
      ) : (
        <div className="chat-area">
          {isNewSessionEmpty ? (
            /* Claude Code Style clean watermark interface */
            <div className="empty-state">
              <Sparkles size={40} style={{ color: 'rgba(59, 130, 246, 0.4)', filter: 'drop-shadow(0 0 8px rgba(59,130,246,0.2))' }} />
              <div className="empty-title" style={{ fontSize: '16px', fontWeight: '600', color: '#fff', marginTop: '14px' }}>
                QuickAI Chat Launcher
              </div>
              <div className="empty-desc" style={{ fontSize: '12.5px', color: '#6b7280', marginTop: '6px', maxWidth: '380px' }}>
                按 Alt+/ 快速显示/隐藏。输入问句直接开始；输入 `/` 可以触发技能或选择加载历史聊天。
              </div>
            </div>
          ) : (
            /* Scrollable Conversation History */
            <div className="messages-container">
              {activeSession?.messages.map((msg, idx) => (
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
                          {msg.files && msg.files.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              {msg.files.map((f, fileIdx) => (
                                <div key={fileIdx} style={{ fontSize: '11px', background: 'rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Paperclip size={10} />
                                  <span>{f.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {renderMessageContent(msg.content)}
                        </div>

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
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Attached Files List Preview */}
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

          {/* Input Area */}
          <div className="chat-input-section">
            {autocompleteItems.length > 0 && (
              <div className="skills-menu">
                {autocompleteItems.map((item, idx) => (
                  <div key={item.id} className={`skills-item ${selectedItemIdx === idx ? 'selected' : ''}`} onClick={() => triggerAutocompleteItem(item)}>
                    <span className="skills-name">{item.name}</span>
                    <span className="skills-trigger" style={{ color: item.isSession ? '#3b82f6' : '#9ca3af' }}>{item.trigger}</span>
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

      {/* Models Selection Pop-up Modal */}
      {showModelsModal && (
        <div className="modal-backdrop" onClick={() => setShowModelsModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">获取到的模型列表 ({fetchedModels.length})</span>
              <button className="header-action-btn" onClick={() => setShowModelsModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {fetchedModels.map((modelId) => {
                const isAdded = modelsList.includes(modelId)
                return (
                  <div key={modelId} className="modal-list-item">
                    <span className="modal-model-id" title={modelId}>{modelId}</span>
                    {isAdded ? (
                      <button className="modal-action-btn remove" onClick={() => handleToggleModelSelection(modelId)} title="移除此模型">
                        <Minus size={14} />
                      </button>
                    ) : (
                      <button className="modal-action-btn add" onClick={() => handleToggleModelSelection(modelId)} title="添加此模型">
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="modal-footer">
              <button className="modal-close-btn" onClick={() => setShowModelsModal(false)}>完成</button>
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
