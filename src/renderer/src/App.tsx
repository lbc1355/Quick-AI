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
  reasoning_content?: string
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

  // Collapse / Expand state for Reasoning Blocks (message ID -> boolean)
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({})

  // Skills & History Autocomplete state
  const [skills, setSkills] = useState<Skill[]>([])
  const [autocompleteItems, setAutocompleteItems] = useState<any[]>([])
  const [selectedItemIdx, setSelectedItemIdx] = useState(0)

  // Refs for scrolling and textarea
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track latest sessions state in a ref to avoid stale closures in async handlers
  const sessionsRef = useRef<Session[]>([])
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

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

  // Auto-resize main input textarea height based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = '24px' // Reset to default line height
      const scrollHeight = textarea.scrollHeight
      if (scrollHeight > 24) {
        textarea.style.height = `${scrollHeight}px`
      }
    }
  }, [inputVal])

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

  // Show standard commands and shortcuts cheatsheet inside the chat
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
* 🕒 \`/history:会话名\` - 快捷加载以往历史对话`
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

  // Autocomplete change: system commands + skills + model commands + session histories
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputVal(val)

    if (val.startsWith('/')) {
      const search = val.slice(1).toLowerCase()
      
      // 1. Built-in System Commands
      const systemCommands = [
        { id: 'cmd-new', name: '🆕 新建对话 (Start new chat)', trigger: '/new', cmd: 'new', type: 'command' },
        { id: 'cmd-clear', name: '🧹 清空当前对话 (Clear current chat)', trigger: '/clear', cmd: 'clear', type: 'command' },
        { id: 'cmd-settings', name: '⚙️ 打开应用设置 (Open settings)', trigger: '/settings', cmd: 'settings', type: 'command' },
        { id: 'cmd-help', name: 'ℹ️ 显示快捷指令帮助 (Show help)', trigger: '/help', cmd: 'help', type: 'command' },
        { id: 'cmd-exit', name: '❌ 隐藏/关闭窗口 (Hide window)', trigger: '/exit', cmd: 'exit', type: 'command' }
      ]
      const matchingCmds = systemCommands.filter((c) =>
        c.trigger.toLowerCase().startsWith(val.toLowerCase())
      )
      
      // 2. Predefined Skills
      const matchingSkills = skills
        .filter((s) => `/${s.trigger}`.toLowerCase().startsWith(val.toLowerCase()) || s.name.toLowerCase().includes(search))
        .map((s) => ({
          id: s.id,
          name: s.name,
          trigger: `/${s.trigger}`,
          prompt: s.prompt,
          type: 'skill'
        }))
      
      // 3. Models switching command options
      const matchingModels = modelsList
        .filter((m) => `/model:${m}`.toLowerCase().includes(val.toLowerCase()) || m.toLowerCase().includes(search))
        .map((m) => ({
          id: `model-${m}`,
          name: `🔄 使用大模型 ${m}`,
          trigger: `/model:${m}`,
          modelId: m,
          type: 'model'
        }))

      // 4. Session histories (exclude active one and empty ones)
      const matchingSessions = sessions
        .filter((s) => s.id !== activeSessionId && s.messages.length > 0)
        .filter((s) => s.title.toLowerCase().includes(search) || 'history'.includes(search))
        .map((s) => ({
          id: s.id,
          name: s.title,
          trigger: `/history:${s.id}`,
          prompt: '',
          type: 'session'
        }))

      const combined = [...matchingCmds, ...matchingSkills, ...matchingModels, ...matchingSessions]
      setAutocompleteItems(combined)
      setSelectedItemIdx((prev) => {
        if (combined.length === 0) return 0
        if (prev < 0 || prev >= combined.length) return 0
        return prev
      })
    } else {
      setAutocompleteItems([])
    }
  }

  // Action executed on autocomplete item select
  const triggerAutocompleteItem = async (item: any) => {
    if (!item) return
    if (item.type === 'command') {
      if (item.cmd === 'new') {
        await handleNewSession()
      } else if (item.cmd === 'clear') {
        await handleClearCurrentSession()
      } else if (item.cmd === 'settings') {
        setShowSettings(true)
      } else if (item.cmd === 'help') {
        await showHelpMessage()
      } else if (item.cmd === 'exit') {
        window.api.hideWindow()
      }
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'session') {
      // Switch conversation session
      setActiveSessionId(item.id)
      setShowSettings(false)
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'model') {
      // Switch active model instantly
      setSelectedModel(item.modelId)
      
      // Save directly to the storage in background
      const currentSettings = await window.api.storeGet('settings') as AppSettings
      if (currentSettings) {
        currentSettings.model = item.modelId
        await window.api.storeSet('settings', currentSettings)
      }
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
      content: '',
      reasoning_content: ''
    }
    currentSession.messages.push(assistantMsg)
    setSessions([...currentSessions])

    // Expand reasoning block by default when generating R1 content
    setExpandedReasoningIds((prev) => ({ ...prev, [assistantMsgId]: true }))

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
      let accumulatedReasoning = ''

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
              const reasoningContent = json.choices[0]?.delta?.reasoning_content || ''
              const content = json.choices[0]?.delta?.content || ''

              if (reasoningContent) {
                accumulatedReasoning += reasoningContent
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

              if (content) {
                accumulatedText += content
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

  // Parse reasoning process from either official API properties or local Ollama `<think>` tags
  const parseThinkTags = (content: string, reasoningContent?: string) => {
    let finalContent = content
    let finalReasoning = reasoningContent || ''

    if (content.includes('<think>')) {
      const parts = content.split('</think>')
      if (parts.length > 1) {
        // Thinking completed
        finalReasoning = parts[0].replace('<think>', '').trim()
        finalContent = parts.slice(1).join('').trim()
      } else {
        // Thinking in progress
        finalReasoning = content.replace('<think>', '').trim()
        finalContent = ''
      }
    }

    return { content: finalContent, reasoning: finalReasoning }
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

  const getTriggerColor = (type: string) => {
    if (type === 'command') return '#f59e0b' // Amber/Orange for system commands
    if (type === 'session') return '#3b82f6' // Blue for history session
    if (type === 'model') return '#a855f7'   // Purple for switching model
    return '#10b981'                         // Green for prompt skills
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
              {activeSession?.messages.map((msg, idx) => {
                // Parse think tags dynamically from content
                const { content: displayContent, reasoning: displayReasoning } = parseThinkTags(msg.content, msg.reasoning_content)
                const isExpanded = expandedReasoningIds[msg.id] !== false
                
                const toggleReasoning = () => {
                  setExpandedReasoningIds((prev) => ({
                    ...prev,
                    [msg.id]: !isExpanded
                  }))
                }

                return (
                  <div key={msg.id} className={`message-bubble ${msg.role}`}>
                    <div className={`avatar ${msg.role}`}>
                      {msg.role === 'user' ? 'U' : 'AI'}
                    </div>
                    <div className="message-content-wrapper" style={{ maxWidth: '100%' }}>
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

                            {/* Thinking/Reasoning block rendering (DeepSeek R1 style) */}
                            {displayReasoning && (
                              <div className="reasoning-block" style={{ marginBottom: '10px' }}>
                                <div 
                                  onClick={toggleReasoning}
                                  style={{ 
                                    fontSize: '12px', 
                                    color: '#60a5fa', 
                                    cursor: 'pointer', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '6px',
                                    userSelect: 'none',
                                    marginBottom: '6px',
                                    fontWeight: '600'
                                  }}
                                >
                                  <Sparkles size={11} style={{ animation: isGenerating && !displayContent ? 'spin 3s linear infinite' : 'none' }} />
                                  <span>{isGenerating && !displayContent ? '正在思考中..' : (isExpanded ? '思考过程 (收起)' : '思考过程 (展开)')}</span>
                                </div>
                                {isExpanded && (
                                  <div style={{ 
                                    fontSize: '12px', 
                                    color: '#8b949e', 
                                    borderLeft: '2px solid rgba(96, 165, 250, 0.35)', 
                                    paddingLeft: '10px', 
                                    marginLeft: '4px',
                                    fontStyle: 'italic',
                                    whiteSpace: 'pre-wrap',
                                    lineHeight: '1.6',
                                    background: 'rgba(255, 255, 255, 0.01)',
                                    padding: '6px 10px',
                                    borderRadius: '0 6px 6px 0'
                                  }}>
                                    {displayReasoning}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Render main text content */}
                            {displayContent ? (
                              renderMessageContent(displayContent)
                            ) : (
                              /* Show small thinking pulsing dot if thinking and content is empty */
                              isGenerating && displayReasoning && <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>思考完毕，正在生成回答..</span>
                            )}
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
                )
              })}
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
                    <span className="skills-trigger" style={{ color: getTriggerColor(item.type) }}>{item.trigger}</span>
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
