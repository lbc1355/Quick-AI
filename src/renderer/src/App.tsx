import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Settings,
  Send,
  Paperclip,
  Terminal,
  Sparkles,
  Trash2,
  Undo2,
  Sun,
  Moon,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  GitBranch,
  ArrowLeft
} from 'lucide-react'

import { AutocompleteItem, AppSettings } from '../../shared/types'
import { ModelsModal } from './components/ModelsModal'
import { FilePreviewList } from './components/FilePreviewList'
import { MessageBubble } from './components/MessageBubble'
import { SettingsView } from './components/SettingsView'

import { useSessions } from './hooks/useSessions'
import { useProviders } from './hooks/useProviders'
import { useAttachments } from './hooks/useAttachments'
import { useAutocomplete } from './hooks/useAutocomplete'
import { useChatCompletion } from './hooks/useChatCompletion'
import { useSkills } from './hooks/useSkills'
import {
  buildBranchFamilyInfo,
  buildBranchChildIndex,
  getBranchDisplayInfo,
  getBranchFamilyRootId,
  getBranchSourceKey
} from './utils/branchDisplay'
import { getSessionGenerationState } from './utils/generationState'

interface PopupOption {
  label: string
  payload:
    | boolean
    | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
}

function getCommandPrefixes(command: string): string[] {
  if (!command) return []
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((t) => !t.startsWith('-'))
  const prefixes: string[] = []
  if (tokens.length > 0) {
    prefixes.push(tokens[0])
    // Only allow second token if it matches a valid alphanumeric subcommand pattern (no paths, dots, slashes)
    if (tokens.length > 1 && /^[a-zA-Z0-9_-]+$/.test(tokens[1])) {
      prefixes.push(`${tokens[0]} ${tokens[1]}`)
    }
  }
  return prefixes
}

function getPopupOptions(pending: { toolName: string; args: unknown } | null): PopupOption[] {
  if (!pending) return []

  const options: PopupOption[] = [
    { label: '允许本次执行 (Yes, allow this time)', payload: { approved: true } },
    {
      label: `在此任务中允许所有 "${pending.toolName}" 工具的调用`,
      payload: { approved: true, scope: 'tool', tool: pending.toolName }
    }
  ]

  if (pending.toolName === 'shell' && pending.args && typeof pending.args === 'object') {
    const argsObj = pending.args as Record<string, unknown>
    const command = typeof argsObj.command === 'string' ? argsObj.command : ''
    const prefixes = getCommandPrefixes(command)
    for (const prefix of prefixes) {
      options.push({
        label: `在此任务中允许所有 "${prefix}" 开头的命令`,
        payload: { approved: true, scope: 'prefix', prefix }
      })
    }
  }

  options.push({ label: '拒绝执行 (No)', payload: { approved: false } })
  return options
}

const commandText: Record<string, { title: string; description: string }> = {
  new: { title: '新对话', description: '开始一个空白对话' },
  clear: { title: '清空当前对话', description: '移除当前对话里的消息' },
  settings: { title: '设置', description: '打开模型、服务商和应用设置' },
  help: { title: '帮助', description: '显示快捷命令说明' },
  exit: { title: '隐藏面板', description: '收起 QuickAI 窗口' }
}

const autocompleteTypeOrder: AutocompleteItem['type'][] = [
  'command',
  'skill',
  'model',
  'provider',
  'session',
  'delete-session'
]

const autocompleteGroupLabels: Record<AutocompleteItem['type'], string> = {
  command: '命令',
  skill: '技能',
  model: '模型',
  provider: '服务商',
  session: '历史对话',
  'delete-session': '删除对话'
}

const emojiPattern =
  /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g

function cleanAutocompleteText(value: string): string {
  return value.replace(emojiPattern, '').replace(/\s+/g, ' ').trim()
}

function splitAutocompleteName(value: string): { title: string; description: string } {
  const clean = cleanAutocompleteText(value)
  const parts = clean.split(/\s+-\s+/)
  return {
    title: parts[0] || clean,
    description: parts.slice(1).join(' - ')
  }
}

function getAutocompleteTitle(item: AutocompleteItem): string {
  if (item.type === 'command' && item.cmd && commandText[item.cmd]) {
    return commandText[item.cmd].title
  }
  if (item.type === 'model') return item.modelId || splitAutocompleteName(item.name).title
  if (item.type === 'provider')
    return splitAutocompleteName(item.name).title.replace(/^切换服务商\s*/, '')
  if (item.type === 'delete-session') {
    return splitAutocompleteName(item.name).title.replace(/^删除会话[:：]?\s*/, '')
  }
  return splitAutocompleteName(item.name).title
}

function getAutocompleteDescription(item: AutocompleteItem): string {
  if (item.type === 'command' && item.cmd && commandText[item.cmd]) {
    return commandText[item.cmd].description
  }
  const split = splitAutocompleteName(item.name)
  if (item.type === 'skill') return split.description || '插入或运行自定义技能'
  if (item.type === 'model') return '切换当前模型'
  if (item.type === 'provider') return '切换当前服务商'
  if (item.type === 'session') return '打开历史对话'
  if (item.type === 'delete-session') return '删除这个历史对话'
  return split.description
}

function getAutocompleteMeta(item: AutocompleteItem): string {
  if (item.type === 'skill') {
    if (item.skillMode === 'run') return '运行'
    if (item.skillMode === 'send') return '发送'
    return '插入'
  }
  return autocompleteGroupLabels[item.type]
}

function groupAutocompleteItems(items: AutocompleteItem[]): Array<{
  type: AutocompleteItem['type']
  label: string
  items: Array<{ item: AutocompleteItem; index: number }>
}> {
  const indexedItems = items.map((item, index) => ({ item, index }))

  return autocompleteTypeOrder
    .map((type) => ({
      type,
      label: autocompleteGroupLabels[type],
      items: indexedItems.filter(({ item }) => item.type === type)
    }))
    .filter((group) => group.items.length > 0)
}

function App(): React.JSX.Element {
  // Navigation
  const [showSettings, setShowSettings] = useState(false)
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number>(0)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isPanelPinned, setIsPanelPinned] = useState(false)

  // 1. Providers hook
  const {
    apiKey,
    setApiKey,
    apiUrl,
    selectedModel,
    setSelectedModel,
    modelsList,
    systemPrompt,
    setSystemPrompt,
    autoHideOnBlur,
    setAutoHideOnBlur,
    appStorePath,
    saveSuccess,
    theme,
    toggleTheme,
    providers,
    setProviders,
    activeProviderId,
    editingProviderId,
    isEditingProviderDetail,
    setIsEditingProviderDetail,
    showAddForm,
    setShowAddForm,
    newProviderName,
    setNewProviderName,
    newProviderType,
    setNewProviderType,
    manualModelInput,
    setManualModelInput,
    fetchModelsUrl,
    setFetchModelsUrl,
    isFetchingModels,
    fetchedModels,
    showModelsModal,
    setShowModelsModal,
    handleApiUrlChange,
    handleSaveGlobalSettings,
    handleSaveProviderDetails,
    handleAddProvider,
    handleSetActiveProvider,
    handleStartEditingProvider,
    handleDeleteProvider,
    handleAddManualModel,
    handleFetchModels,
    handleRemoveModelDirectly,
    handleToggleModelSelection,
    resetLocalSettings,
    permissions,
    onChangeToolPermission
  } = useProviders()

  // Close settings panel and restore local editor states
  const handleCloseSettings = useCallback((): void => {
    setShowSettings(false)
    resetLocalSettings()
  }, [resetLocalSettings])

  // 2. Sessions hook
  const {
    sessions,
    setSessions,
    sessionsRef,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    handleNewSession,
    handleClearCurrentSession,
    handleDeleteSession,
    syncSessionsRef
  } = useSessions()
  const [sessionFamilyRootId, setSessionFamilyRootId] = useState<string | null>(null)
  const [dismissedSessionFamilyViewForId, setDismissedSessionFamilyViewForId] = useState<
    string | null
  >(null)

  // Refs for scrolling and textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null)

  // 3. Attachments hook
  const {
    dragActive,
    attachedFiles,
    setAttachedFiles,
    fileInputRef,
    handleFileChange,
    handlePaste,
    handleDrag,
    handleDrop,
    handleRemoveFile
  } = useAttachments(textareaRef)

  // 4. Chat Completion hook
  const {
    inputVal,
    setInputVal,
    isGenerating,
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
    handleAbortGeneration
  } = useChatCompletion({
    setSessions,
    setActiveSessionId,
    activeSessionId,
    sessionsRef,
    apiKey,
    apiUrl,
    selectedModel,
    systemPrompt,
    setShowSettings: setShowSettings,
    attachedFiles,
    setAttachedFiles
  })

  const { isCurrentSessionGenerating, isOtherSessionGenerating } = getSessionGenerationState(
    isGenerating,
    activeGenerationSessionId,
    activeSessionId
  )

  // 5. Autocomplete hook
  const {
    autocompleteItems,
    setAutocompleteItems,
    selectedItemIdx,
    skillsMenuRef,
    updateAutocompleteItems,
    handleInputKeyDown: autocompleteKeyDown
  } = useAutocomplete()

  // 6. Markdown Skills hook
  const { skills, installSkill, removeSkill } = useSkills()

  const activeSessionFamilyInfo = useMemo(() => {
    if (!activeSessionId) return null
    const rootId = getBranchFamilyRootId(activeSessionId, sessions)
    const info = buildBranchFamilyInfo(rootId, sessions)
    return info && info.members.length > 1 ? info : null
  }, [activeSessionId, sessions])
  const isSessionFamilyViewDismissed = dismissedSessionFamilyViewForId === activeSessionId

  const visibleSessionFamilyInfo = useMemo(() => {
    const effectiveRootId = isSessionFamilyViewDismissed
      ? sessionFamilyRootId
      : sessionFamilyRootId || activeSessionFamilyInfo?.rootSessionId
    if (!effectiveRootId) return null
    const info = buildBranchFamilyInfo(effectiveRootId, sessions)
    return info && info.members.length > 1 ? info : null
  }, [
    activeSessionFamilyInfo?.rootSessionId,
    isSessionFamilyViewDismissed,
    sessionFamilyRootId,
    sessions
  ])

  const enterSessionFamilyView = useCallback(
    (sessionId: string): void => {
      const rootId = getBranchFamilyRootId(sessionId, sessions)
      const info = buildBranchFamilyInfo(rootId, sessions)
      setSessionFamilyRootId(info && info.members.length > 1 ? rootId : null)
      setDismissedSessionFamilyViewForId(null)
    },
    [sessions]
  )

  const exitSessionFamilyView = useCallback((): void => {
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(activeSessionId ?? null)
  }, [activeSessionId])

  const openSession = useCallback(
    (sessionId: string, messageId?: string): void => {
      if (messageId) {
        setPendingScrollMessageId(messageId)
      }
      enterSessionFamilyView(sessionId)
      setActiveSessionId(sessionId)
      setAutocompleteItems([])
    },
    [enterSessionFamilyView, setActiveSessionId, setAutocompleteItems]
  )

  // Listen to window summon (focus/show) event from Main Process
  useEffect(() => {
    const handleWindowShown = (): void => {
      syncSessionsRef(sessions)
    }

    // Register event listener
    window.electron.ipcRenderer.on('window-shown', handleWindowShown)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('window-shown')
    }
  }, [sessions, syncSessionsRef])

  useEffect(() => {
    window.api.setWindowPinned(isPanelPinned)
    return () => window.api.setWindowPinned(false)
  }, [isPanelPinned])

  // Reset auto-scroll flag to true when a new message starts generating
  useEffect(() => {
    if (isCurrentSessionGenerating) {
      shouldAutoScrollRef.current = true
    }
  }, [isCurrentSessionGenerating])

  // Auto-scroll when messages update
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        const behavior = isCurrentSessionGenerating ? 'auto' : 'smooth'
        if (behavior === 'smooth') {
          isProgrammaticScrollRef.current = true
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          })
          const timeoutId = setTimeout(() => {
            isProgrammaticScrollRef.current = false
          }, 500)
          return () => clearTimeout(timeoutId)
        } else {
          container.scrollTop = container.scrollHeight
        }
      }
    }
    return undefined
  }, [activeSession?.messages, activeSessionId, isCurrentSessionGenerating])

  useEffect(() => {
    if (!pendingScrollMessageId) return

    const container = messagesContainerRef.current
    const target = container?.querySelector<HTMLElement>(
      `[data-message-id="${pendingScrollMessageId}"]`
    )
    if (!target) return

    shouldAutoScrollRef.current = false
    isProgrammaticScrollRef.current = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const timeoutId = setTimeout(() => {
      isProgrammaticScrollRef.current = false
      setPendingScrollMessageId(null)
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [activeSessionId, activeSession?.messages.length, pendingScrollMessageId])

  // Handle manual scroll detection
  const handleScroll = (): void => {
    const container = messagesContainerRef.current
    if (!container) return

    // If it's a programmatic scroll (like smooth scrolling on load), ignore it
    if (isProgrammaticScrollRef.current) return

    const threshold = 15 // pixels from bottom
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    if (isAtBottom) {
      shouldAutoScrollRef.current = true
    } else {
      shouldAutoScrollRef.current = false
    }
  }

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

  // Trigger escape key listener for hierarchy back navigation or window hiding
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return

      // Do not allow ESC action during active AI generation to prevent accidental interruption
      if (isCurrentSessionGenerating) return

      if (showModelsModal) {
        e.preventDefault()
        setShowModelsModal(false)
      } else if (showAddForm) {
        e.preventDefault()
        setShowAddForm(false)
      } else if (isEditingProviderDetail) {
        e.preventDefault()
        setIsEditingProviderDetail(false)
      } else if (showSettings) {
        e.preventDefault()
        handleCloseSettings()
      } else {
        window.api.hideWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isCurrentSessionGenerating,
    showModelsModal,
    showAddForm,
    isEditingProviderDetail,
    showSettings,
    setShowModelsModal,
    setShowAddForm,
    setIsEditingProviderDetail,
    handleCloseSettings
  ])

  // Autocomplete change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setInputVal(val)
    updateAutocompleteItems(val, modelsList, sessions, activeSessionId, providers, skills)
  }

  const getSkillInputTail = (item: AutocompleteItem): string => {
    const currentValue = inputVal.trimStart()
    return currentValue.toLowerCase().startsWith(item.trigger.toLowerCase())
      ? currentValue.slice(item.trigger.length).trim()
      : ''
  }

  const buildSkillPrompt = (item: AutocompleteItem): string => {
    const prompt = item.prompt || ''
    const inputTail = getSkillInputTail(item)
    if (/\{\{\s*input\s*\}\}/i.test(prompt)) {
      return prompt.replace(/\{\{\s*input\s*\}\}/gi, inputTail)
    }

    return inputTail ? `${prompt.trimEnd()}\n\n${inputTail}` : prompt
  }

  // Action executed on autocomplete item select
  const triggerAutocompleteItem = async (item: AutocompleteItem): Promise<void> => {
    if (!item) return
    if (item.type === 'command') {
      if (item.cmd === 'new') {
        setSessionFamilyRootId(null)
        setDismissedSessionFamilyViewForId(null)
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
    } else if (item.type === 'delete-session') {
      await handleDeleteSession(item.sessionId || '')
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'session') {
      // Switch conversation session
      enterSessionFamilyView(item.id)
      setActiveSessionId(item.id)
      handleCloseSettings()
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'model') {
      // Switch active model instantly
      setSelectedModel(item.modelId || '')

      // Save directly to the storage in background
      const currentSettings = (await window.api.storeGet('settings')) as AppSettings
      if (currentSettings) {
        // Update active provider's model
        currentSettings.providers = currentSettings.providers.map((p) => {
          if (p.id === currentSettings.activeProviderId) {
            return { ...p, model: item.modelId || '' }
          }
          return p
        })
        await window.api.storeSet('settings', currentSettings)

        // Also update local React state for providers list
        setProviders(currentSettings.providers)
      }
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'provider') {
      // Switch active provider instantly
      await handleSetActiveProvider(item.providerId || '')
      setAutocompleteItems([])
      setInputVal('')
    } else {
      // Injects prompt skill
      setAutocompleteItems([])
      const targetSkill = skills.find((skill) => skill.id === item.skillId || skill.id === item.id)
      if (targetSkill && (targetSkill.kind === 'agent' || targetSkill.mode === 'run')) {
        setInputVal('')
        await handleRunAgentSkill(targetSkill, getSkillInputTail(item))
      } else if (item.skillMode === 'send') {
        setInputVal('')
        const skillPrompt = buildSkillPrompt(item)
        await handleSendMessage(skillPrompt)
      } else {
        const skillPrompt = buildSkillPrompt(item)
        setInputVal(skillPrompt)
      }
    }
    textareaRef.current?.focus()
  }

  // Keyboard navigation inside prompt input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const handled = autocompleteKeyDown(e, triggerAutocompleteItem, (item) => {
      setInputVal(`${item.trigger} `)
      setAutocompleteItems([])
    })
    if (handled) return

    // Submit prompt on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Find pending permission request in the active session
  const getPendingPermission = (): {
    msgId: string
    agentRunId: string
    callId: string
    toolName: string
    args: unknown
  } | null => {
    if (!activeSession) return null
    for (let i = activeSession.messages.length - 1; i >= 0; i--) {
      const msg = activeSession.messages[i]
      if (msg.agentEvents) {
        const pendingEvent = msg.agentEvents.find(
          (e) => e.type === 'tool_call' && e.permissionState === 'pending'
        )
        if (pendingEvent && pendingEvent.type === 'tool_call') {
          return {
            msgId: msg.id,
            agentRunId: msg.agentRunId || '',
            callId: pendingEvent.callId,
            toolName: pendingEvent.toolName,
            args: pendingEvent.args
          }
        }
      }
    }
    return null
  }

  const handlePermissionResponse = (
    approved:
      | boolean
      | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
  ): void => {
    const pending = getPendingPermission()
    if (pending) {
      window.api.respondToolPermission(pending.agentRunId, pending.callId, approved)
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }
  }

  // Reset selected option and manage keyboard shortcuts for pending tool execution permissions
  const pendingPermission = getPendingPermission()
  const pendingCallId = pendingPermission?.callId || null

  const [prevCallId, setPrevCallId] = useState<string | null>(null)
  if (pendingCallId !== prevCallId) {
    setPrevCallId(pendingCallId)
    setSelectedOptionIndex(0)
  }

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      const pending = getPendingPermission()
      if (!pending) return

      const options = getPopupOptions(pending)
      if (options.length === 0) return

      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        e.preventDefault()
        handlePermissionResponse(options[num - 1].payload)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedOptionIndex((prev) => (prev - 1 + options.length) % options.length)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedOptionIndex((prev) => (prev + 1) % options.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (options[selectedOptionIndex]) {
          handlePermissionResponse(options[selectedOptionIndex].payload)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        const denyOption = options.find((o) => {
          if (typeof o.payload === 'boolean') return !o.payload
          return !o.payload.approved
        })
        handlePermissionResponse(denyOption ? denyOption.payload : false)
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, selectedOptionIndex])

  const getArgsText = (toolName: string, args: unknown): string => {
    if (!args || typeof args !== 'object') return ''
    const argsObj = args as Record<string, unknown>
    if (toolName === 'fetch_url') {
      return `URL: ${argsObj.url || ''}`
    }
    if (toolName === 'file_read') {
      return `文件路径: ${argsObj.path || ''}${argsObj.offset ? ` (起始行: ${argsObj.offset})` : ''}`
    }
    if (toolName === 'workspace_search') {
      return `搜索内容: "${argsObj.query || ''}"${argsObj.glob ? ` (匹配模式: ${argsObj.glob})` : ''}`
    }
    if (toolName === 'web_search') {
      return `搜索关键词: "${argsObj.query || ''}"`
    }
    return JSON.stringify(args)
  }

  // Check if current active session is a clean "new session" with no message history
  const isNewSessionEmpty = activeSession && activeSession.messages.length === 0
  const activeProviderName = providers.find((p) => p.id === activeProviderId)?.name || 'No provider'
  const activeModelName = selectedModel || 'No model'
  const orderedSessions = [...sessions].sort((a, b) => {
    const aTime = a.lastActiveTime || Number(a.id)
    const bTime = b.lastActiveTime || Number(b.id)
    return bTime - aTime
  })
  const visibleSessionEntries = visibleSessionFamilyInfo
    ? visibleSessionFamilyInfo.members.map((familyMember) => ({
        session: familyMember.session,
        familyMember
      }))
    : orderedSessions.map((session) => ({ session, familyMember: null }))
  const autocompleteGroups = groupAutocompleteItems(autocompleteItems)
  const formatSessionStamp = (timestamp: number | undefined, id: string): string => {
    const value = timestamp || Number(id)
    if (!Number.isFinite(value)) return ''
    const date = new Date(value)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  const activeBranchInfo = getBranchDisplayInfo(activeSession?.branchOf, sessions, '源会话')
  const branchChildIndex = buildBranchChildIndex(sessions)

  return (
    <div
      className={`app-container ${theme === 'light' ? 'theme-light' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Draggable Top Dragbar */}
      <div className="drag-header">
        <div className="drag-header-left">
          <Sparkles className="logo-icon" size={16} />
          <span className="logo-text">QuickAI</span>
          <div className="chat-model-info" style={{ marginLeft: '12px' }}>
            <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
            <span className="model-name" style={{ fontSize: '12px', color: '#9ca3af' }}>
              {providers.find((p) => p.id === activeProviderId)?.name || '未选服务商'}:{' '}
              {selectedModel}
            </span>
          </div>
        </div>
        <div className="drag-header-right">
          <button
            className="header-action-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            className={`header-action-btn ${isPanelPinned ? 'active' : ''}`}
            onClick={() => setIsPanelPinned((value) => !value)}
            title={isPanelPinned ? '取消固定' : '固定窗口'}
          >
            {isPanelPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          {showSettings ? (
            <button className="header-action-btn" onClick={handleCloseSettings} title="返回聊天">
              <Undo2 size={14} />
            </button>
          ) : (
            <>
              <button
                className="header-action-btn"
                onClick={handleClearCurrentSession}
                title="清空历史"
              >
                <Trash2 size={14} />
              </button>
              <button
                className="header-action-btn"
                onClick={() => window.api.toggleDevTools()}
                title="开发者工具"
              >
                <Terminal size={14} />
              </button>
              <button
                className="header-action-btn"
                onClick={() => setShowSettings(true)}
                title="应用设置"
              >
                <Settings size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {showSettings ? (
        <SettingsView
          isEditingProviderDetail={isEditingProviderDetail}
          editingProviderId={editingProviderId}
          activeProviderId={activeProviderId}
          providers={providers}
          apiKey={apiKey}
          apiUrl={apiUrl}
          selectedModel={selectedModel}
          modelsList={modelsList}
          manualModelInput={manualModelInput}
          fetchModelsUrl={fetchModelsUrl}
          isFetchingModels={isFetchingModels}
          showAddForm={showAddForm}
          newProviderName={newProviderName}
          newProviderType={newProviderType}
          systemPrompt={systemPrompt}
          autoHideOnBlur={autoHideOnBlur}
          appStorePath={appStorePath}
          saveSuccess={saveSuccess}
          skills={skills}
          setIsEditingProviderDetail={setIsEditingProviderDetail}
          setApiKey={setApiKey}
          setSelectedModel={setSelectedModel}
          setManualModelInput={setManualModelInput}
          setFetchModelsUrl={setFetchModelsUrl}
          setShowAddForm={setShowAddForm}
          setNewProviderName={setNewProviderName}
          setNewProviderType={setNewProviderType}
          setSystemPrompt={setSystemPrompt}
          setAutoHideOnBlur={setAutoHideOnBlur}
          onSaveGlobalSettings={handleSaveGlobalSettings}
          onSaveProviderDetails={handleSaveProviderDetails}
          onAddProvider={handleAddProvider}
          onSetActiveProvider={handleSetActiveProvider}
          onStartEditingProvider={handleStartEditingProvider}
          onDeleteProvider={handleDeleteProvider}
          onAddManualModel={handleAddManualModel}
          onFetchModels={handleFetchModels}
          onRemoveModel={handleRemoveModelDirectly}
          onInstallSkill={installSkill}
          onRemoveSkill={removeSkill}
          onChangeEditingProviderName={(name) => {
            setProviders((prev) =>
              prev.map((p) => (p.id === editingProviderId ? { ...p, name } : p))
            )
          }}
          onChangeEditingProviderApiUrl={handleApiUrlChange}
          permissions={permissions}
          onChangeToolPermission={onChangeToolPermission}
        />
      ) : (
        <div className={`chat-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <aside
            className={`session-sidebar ${visibleSessionFamilyInfo ? 'session-family-view' : ''}`}
          >
            <div className="session-sidebar-header">
              <div className="sidebar-heading">
                <div className="sidebar-title">
                  {visibleSessionFamilyInfo ? 'Family' : 'Recent'}
                </div>
                <div className="sidebar-subtitle">
                  {visibleSessionFamilyInfo
                    ? `${visibleSessionFamilyInfo.rootTitle} - ${visibleSessionFamilyInfo.members.length} conversations`
                    : `${sessions.length} conversations`}
                </div>
              </div>
              <div className="sidebar-actions">
                {visibleSessionFamilyInfo && !isSidebarCollapsed && (
                  <button
                    type="button"
                    className="sidebar-icon-btn"
                    onClick={exitSessionFamilyView}
                    title="Back to all chats"
                  >
                    <ArrowLeft size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  onClick={() => setIsSidebarCollapsed((value) => !value)}
                  title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                </button>
              </div>
            </div>

            <div className="session-list">
              {!visibleSessionFamilyInfo && (
                <div className="session-item new-session-item">
                  <button
                    type="button"
                    className="session-main-btn"
                    onClick={() => {
                      setSessionFamilyRootId(null)
                      setDismissedSessionFamilyViewForId(null)
                      void handleNewSession()
                      setAutocompleteItems([])
                    }}
                    title="New chat"
                  >
                    <span className="session-initial" aria-hidden="true">
                      +
                    </span>
                    <span className="session-title">New chat</span>
                    <span className="session-meta">Start a blank conversation</span>
                  </button>
                </div>
              )}
              {visibleSessionEntries.map(({ session, familyMember }) => {
                const isActive = session.id === activeSessionId
                const messageCount = session.messages.length
                const branchInfo = getBranchDisplayInfo(session.branchOf, sessions, '源会话')
                const baseSessionTitle = session.title || 'New chat'
                const sessionTitle = familyMember
                  ? `${familyMember.isRoot ? 'Root' : `Branch ${familyMember.branchIndex}`} - ${baseSessionTitle}`
                  : baseSessionTitle
                const isBranchSession = Boolean(
                  (familyMember && !familyMember.isRoot) || (!familyMember && branchInfo)
                )
                const familySourceTitle =
                  familyMember?.sourceTitle || visibleSessionFamilyInfo?.rootTitle || 'Source chat'
                const familyMeta = familyMember
                  ? familyMember.isRoot
                    ? `${visibleSessionFamilyInfo?.branchCount ?? 0} branches`
                    : `from ${familySourceTitle}${familyMember.shortRunId ? ` / run ${familyMember.shortRunId}` : ''}`
                  : null
                return (
                  <div
                    key={session.id}
                    className={`session-item ${isActive ? 'active' : ''} ${isBranchSession ? 'branch-session-item' : ''} ${familyMember?.isRoot ? 'family-root-session' : ''}`}
                  >
                    <button
                      type="button"
                      className="session-main-btn"
                      onClick={() => {
                        openSession(session.id)
                      }}
                      title={
                        familyMember
                          ? sessionTitle
                          : branchInfo
                            ? `${sessionTitle} · 分支源自 ${branchInfo.sourceLabel}`
                            : sessionTitle
                      }
                    >
                      <span
                        className={`session-initial ${isBranchSession ? 'branch-session-initial' : ''}`}
                        aria-hidden="true"
                      >
                        {isBranchSession ? (
                          <GitBranch size={13} />
                        ) : (
                          (session.title || 'N').trim().charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="session-title">{sessionTitle}</span>
                      <span
                        className={`session-meta ${branchInfo || familyMember ? 'session-meta-with-branch' : ''}`}
                      >
                        {familyMember ? (
                          <>
                            <GitBranch size={10} />
                            <span className="session-branch-source">{familyMeta}</span>
                            <span className="session-meta-divider">-</span>
                          </>
                        ) : (
                          branchInfo && (
                            <>
                              <GitBranch size={10} />
                              <span className="session-branch-source">
                                {branchInfo.sourceTitle}
                              </span>
                              <span className="session-meta-divider">·</span>
                            </>
                          )
                        )}
                        <span>
                          {messageCount} msg{messageCount === 1 ? '' : 's'} -{' '}
                          {formatSessionStamp(session.lastActiveTime, session.id)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-delete-btn"
                      onClick={() => void handleDeleteSession(session.id)}
                      disabled={sessions.length <= 1}
                      title="Delete chat"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="sidebar-model-card">
              <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
              <div className="sidebar-model-text">
                <span>{activeProviderName}</span>
                <strong>{activeModelName}</strong>
              </div>
            </div>
          </aside>

          <section className="conversation-panel">
            {activeBranchInfo && (
              <div className="branch-context-banner">
                <div className="branch-context-main">
                  <GitBranch size={14} />
                  <span className="branch-context-label">分支会话</span>
                  <span className="branch-context-source">源自 {activeBranchInfo.sourceLabel}</span>
                </div>
                <button
                  type="button"
                  className="branch-context-link"
                  onClick={() => {
                    openSession(activeBranchInfo.sourceSessionId, activeBranchInfo.sourceMessageId)
                  }}
                  disabled={!activeBranchInfo.sourceExists}
                  title={activeBranchInfo.sourceExists ? '打开源会话' : '源会话已不存在'}
                >
                  打开源会话
                </button>
              </div>
            )}
            {isNewSessionEmpty ? (
              /* Claude Code Style clean watermark interface */
              <div className="empty-state">
                <Sparkles
                  size={40}
                  style={{
                    color: 'rgba(59, 130, 246, 0.4)',
                    filter: 'drop-shadow(0 0 8px rgba(59,130,246,0.2))'
                  }}
                />
                <div
                  className="empty-title"
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--color-text-title)',
                    marginTop: '14px'
                  }}
                >
                  QuickAI Chat Launcher
                </div>
                <div
                  className="empty-desc"
                  style={{
                    fontSize: '12.5px',
                    color: '#6b7280',
                    marginTop: '6px',
                    maxWidth: '380px'
                  }}
                >
                  按 Alt+/ 快速显示/隐藏。输入问句直接开始；输入 `/`
                  可以触发技能或选择加载历史聊天。
                </div>
              </div>
            ) : (
              /* Scrollable Conversation History */
              <div
                ref={messagesContainerRef}
                className="messages-container"
                onScroll={handleScroll}
              >
                {activeSession?.messages.map((msg, idx) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    idx={idx}
                    branchChildren={
                      branchChildIndex[getBranchSourceKey(activeSessionId, msg.id)] || []
                    }
                    isGenerating={isCurrentSessionGenerating}
                    editingMessageId={editingMessageId}
                    editingText={editingText}
                    onStartEdit={handleStartEdit}
                    onCancelEdit={() => setEditingMessageId(null)}
                    onSaveEdit={handleSaveEdit}
                    onRegenerate={handleRegenerate}
                    onResumeAgentRun={handleResumeAgentRun}
                    onOpenBranch={(sessionId) => openSession(sessionId)}
                    onChangeEditingText={setEditingText}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            <FilePreviewList attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} />

            {/* Input Area */}
            <div className="chat-input-section">
              {autocompleteItems.length > 0 && (
                <div ref={skillsMenuRef} className="skills-menu">
                  {autocompleteGroups.map((group) => (
                    <div key={group.type} className="command-group">
                      <div className="command-group-label">{group.label}</div>
                      {group.items.map(({ item, index: itemIndex }) => {
                        return (
                          <div
                            key={item.id}
                            data-autocomplete-index={itemIndex}
                            className={`skills-item ${selectedItemIdx === itemIndex ? 'selected' : ''}`}
                            onClick={() => triggerAutocompleteItem(item)}
                          >
                            <span className="skills-trigger">{item.trigger}</span>
                            <span className="skills-name">
                              <span className="skills-title">{getAutocompleteTitle(item)}</span>
                              <span className="skills-description">
                                {getAutocompleteDescription(item)}
                              </span>
                            </span>
                            <span className="skills-kind">{getAutocompleteMeta(item)}</span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const pending = getPendingPermission()
                if (!pending) return null
                const argsText = getArgsText(pending.toolName, pending.args)

                return (
                  <div className="permission-popup-container">
                    <div className="permission-popup-header">
                      <Terminal size={14} style={{ color: 'var(--color-primary)' }} />
                      <span>是否允许执行此工具？</span>
                    </div>

                    {argsText && (
                      <div className="permission-popup-code">
                        {pending.toolName} {argsText}
                      </div>
                    )}

                    <div className="permission-popup-options">
                      {getPopupOptions(pending).map((opt, idx) => (
                        <div
                          key={idx}
                          className={`permission-popup-option ${selectedOptionIndex === idx ? 'selected' : ''}`}
                          onClick={() => handlePermissionResponse(opt.payload)}
                        >
                          <span className="permission-popup-badge">{idx + 1}</span>
                          <span>{opt.label}</span>
                        </div>
                      ))}
                    </div>

                    <div className="permission-popup-footer">
                      <button
                        className="permission-popup-btn skip"
                        onClick={() => {
                          const options = getPopupOptions(pending)
                          const denyOption = options.find((o) => {
                            if (typeof o.payload === 'boolean') return !o.payload
                            return !o.payload.approved
                          })
                          handlePermissionResponse(denyOption ? denyOption.payload : false)
                        }}
                      >
                        Skip
                      </button>
                      <button
                        className="permission-popup-btn submit"
                        onClick={() => {
                          const options = getPopupOptions(pending)
                          if (options[selectedOptionIndex]) {
                            handlePermissionResponse(options[selectedOptionIndex].payload)
                          }
                        }}
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )
              })()}

              <div className="input-container">
                <label
                  htmlFor="file-input"
                  className="input-action-btn"
                  title="上传文件 (支持拖拽/粘贴图片)"
                  style={{ cursor: 'pointer' }}
                >
                  <Paperclip size={16} />
                  <input
                    ref={fileInputRef}
                    id="file-input"
                    type="file"
                    style={{ display: 'none' }}
                    multiple
                    onChange={handleFileChange}
                    onClick={() => window.api.setFilePickerActive(true)}
                  />
                </label>
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  placeholder={
                    pendingPermission
                      ? '请先响应上方的工具执行权限请求...'
                      : '输入您的问题... (Esc 隐藏, Shift+Enter 换行, / 命令快捷词)'
                  }
                  value={pendingPermission ? '' : inputVal}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  onPaste={handlePaste}
                  rows={1}
                  disabled={!!pendingPermission}
                />
                <div className="chat-actions">
                  <button
                    type="button"
                    className={`run-mode-btn ${runMode}`}
                    onClick={() => setRunMode(runMode === 'chat' ? 'agent' : 'chat')}
                    title={
                      runMode === 'agent'
                        ? '当前为 Agent 模式 (支持动态工具发现)'
                        : '当前为普通 Chat 模式'
                    }
                  >
                    <Sparkles size={13} className="sparkle-icon" />
                    <span>{runMode === 'agent' ? 'Agent' : 'Chat'}</span>
                  </button>
                  {isCurrentSessionGenerating ? (
                    <button
                      className="input-action-btn stop"
                      onClick={handleAbortGeneration}
                      title="终止回答"
                      style={{ color: '#ef4444' }}
                    >
                      <Square size={14} fill="#ef4444" />
                    </button>
                  ) : (
                    <button
                      className="input-action-btn send"
                      onClick={() => handleSendMessage()}
                      disabled={
                        isOtherSessionGenerating || (!inputVal.trim() && attachedFiles.length === 0)
                      }
                      title={isOtherSessionGenerating ? '另一个会话正在生成' : '发送消息'}
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Models Selection Pop-up Modal */}
      {showModelsModal && (
        <ModelsModal
          fetchedModels={fetchedModels}
          modelsList={modelsList}
          onToggleModel={handleToggleModelSelection}
          onClose={() => setShowModelsModal(false)}
        />
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
