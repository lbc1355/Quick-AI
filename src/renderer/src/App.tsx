import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Sparkles, GitBranch, Paperclip, ArrowDown } from 'lucide-react'

import {
  AutocompleteItem,
  AppSettings,
  Project,
  WindowState
} from '../../shared/types'
import { ModelsModal } from './components/ModelsModal'
import { MessageBubble } from './components/MessageBubble'
import { SettingsView } from './components/SettingsView'

import { useSessions } from './hooks/useSessions'
import { useProviders } from './hooks/useProviders'
import { useAttachments } from './hooks/useAttachments'
import { useAutocomplete } from './hooks/useAutocomplete'
import { useChatCompletion } from './hooks/useChatCompletion'
import { useSkills } from './hooks/useSkills'
import { useUserChoiceRequest } from './hooks/useUserChoiceRequest'

import {
  buildBranchFamilyInfo,
  buildBranchChildIndex,
  getBranchDisplayInfo,
  getBranchFamilyRootId,
  getBranchSourceKey
} from './utils/branchDisplay'
import { getSessionGenerationState } from './utils/generationState'
import {
  estimateBaseConversationContextTokens,
  estimateDraftContextTokens,
  formatContextTokenCount
} from './utils/contextLength'

import { AppHeader } from './components/AppHeader'
import { SessionSidebar } from './components/SessionSidebar'
import { ChatInputArea } from './components/ChatInputArea'
import { UserChoicePopup } from './components/UserChoicePopup'
import { getPopupOptions, groupAutocompleteItems } from './utils/autocompleteHelpers'

interface PendingPermission {
  msgId: string
  agentRunId: string
  callId: string
  toolName: string
  args: unknown
}

const buildMessageNavPreview = (
  content: string,
  files?: Array<{ name: string; content: string; type: string }>
): string => {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]\s*/gm, ' ')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text) return text.length > 88 ? `${text.slice(0, 85)}...` : text

  const fileNames = files?.map((file) => file.name).filter(Boolean) || []
  if (fileNames.length > 0) {
    const shown = fileNames.slice(0, 2).join(', ')
    return fileNames.length > 2 ? `附件：${shown} 等 ${fileNames.length} 个文件` : `附件：${shown}`
  }

  return '空消息'
}

function App(): React.JSX.Element {
  // Navigation
  const [showSettings, setShowSettings] = useState(false)
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number>(0)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isPanelPinned, setIsPanelPinned] = useState(false)
  const [windowState, setWindowState] = useState<WindowState>({
    mode: 'window',
    isMaximized: false
  })
  const [projects, setProjects] = useState<Project[]>([])

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
    onChangeToolPermission,
    webSearchProvider,
    setWebSearchProvider,
    webSearchApiKey,
    setWebSearchApiKey
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

  useEffect(() => {
    let disposed = false
    window.api
      .storeGet('projects')
      .then((savedProjects) => {
        if (!disposed) setProjects(savedProjects || [])
      })
      .catch((err) => console.warn('Failed to load projects:', err))
    return () => {
      disposed = true
    }
  }, [])

  const persistProjects = useCallback(async (nextProjects: Project[]): Promise<void> => {
    setProjects(nextProjects)
    await window.api.storeSet('projects', nextProjects)
  }, [])

  const normalizeProjectPath = useCallback((projectPath: string): string => {
    const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
    return normalized.toLowerCase()
  }, [])

  const activeProject = useMemo(() => {
    if (!activeSession?.projectId) return null
    return projects.find((project) => project.id === activeSession.projectId) || null
  }, [activeSession?.projectId, projects])

  const projectSessionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      if (!session.projectId) continue
      counts.set(session.projectId, (counts.get(session.projectId) || 0) + 1)
    }
    return counts
  }, [sessions])

  const openProject = useCallback(
    async (projectId: string): Promise<void> => {
      const projectSessions = sessions
        .filter((session) => session.projectId === projectId)
        .sort((a, b) => {
          const aTime = a.lastActiveTime || Number(a.id)
          const bTime = b.lastActiveTime || Number(b.id)
          return bTime - aTime
        })

      setSessionFamilyRootId(null)
      setDismissedSessionFamilyViewForId(null)
      if (projectSessions[0]) {
        setActiveSessionId(projectSessions[0].id)
      } else {
        await handleNewSession({ projectId })
      }
    },
    [handleNewSession, sessions, setActiveSessionId]
  )

  const openFreeConversations = useCallback(async (): Promise<void> => {
    const freeSessions = sessions
      .filter((session) => !session.projectId)
      .sort((a, b) => {
        const aTime = a.lastActiveTime || Number(a.id)
        const bTime = b.lastActiveTime || Number(b.id)
        return bTime - aTime
      })

    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(null)
    if (freeSessions[0]) {
      setActiveSessionId(freeSessions[0].id)
    } else {
      await handleNewSession()
    }
  }, [handleNewSession, sessions, setActiveSessionId])

  const handleAddProject = useCallback(async (): Promise<void> => {
    const selected = await window.api.selectProjectDirectory()
    if (!selected) return

    const existing = projects.find(
      (project) => normalizeProjectPath(project.path) === normalizeProjectPath(selected.path)
    )
    if (existing) {
      await openProject(existing.id)
      return
    }

    const now = Date.now()
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name:
        selected.name ||
        selected.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
        'Project',
      path: selected.path,
      createdAt: now,
      updatedAt: now
    }
    const nextProjects = [project, ...projects]
    await persistProjects(nextProjects)
    await handleNewSession({ projectId: project.id })
    setSessionFamilyRootId(null)
    setDismissedSessionFamilyViewForId(null)
  }, [handleNewSession, normalizeProjectPath, openProject, persistProjects, projects])

  const handleDeleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return
      const relatedCount = sessions.filter((session) => session.projectId === projectId).length
      const confirmed = window.confirm(
        relatedCount > 0
          ? `移除项目「${project.name}」？磁盘文件不会被删除，${relatedCount} 个对话会保留为自由对话。`
          : `移除项目「${project.name}」？磁盘文件不会被删除。`
      )
      if (!confirmed) return

      const nextProjects = projects.filter((item) => item.id !== projectId)
      const nextSessions = sessions.map((session) =>
        session.projectId === projectId ? { ...session, projectId: undefined } : session
      )
      await persistProjects(nextProjects)
      setSessions(nextSessions)
      sessionsRef.current = nextSessions
      await window.api.storeSet('sessions', nextSessions)
    },
    [persistProjects, projects, sessions, sessionsRef, setSessions]
  )

  // Refs for scrolling and textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputDraftRef = useRef('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesInnerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [activeMessageNavId, setActiveMessageNavId] = useState<string | null>(null)
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
    projects,
    apiKey,
    apiUrl,
    selectedModel,
    systemPrompt,
    setShowSettings: setShowSettings,
    attachedFiles,
    setAttachedFiles
  })

  const { pendingUserChoice, handleUserChoiceResponse } = useUserChoiceRequest({
    isGenerating,
    textareaRef
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

  // Reset active task message and task panel state when active session changes using render-phase state adjustment
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId)
  if (activeSessionId !== prevSessionId) {
    setPrevSessionId(activeSessionId)
  }

  useEffect(() => {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    setActiveMessageNavId(null)
  }, [activeSessionId])

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
    let disposed = false
    window.api
      .getWindowState()
      .then((state) => {
        if (!disposed) setWindowState(state)
      })
      .catch(() => {
        // Keep the default window state if the host API is unavailable during early startup.
      })

    const unsubscribe = window.api.onWindowStateChanged((state) => {
      setWindowState(state)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const handleToggleWindowMode = useCallback(async (): Promise<void> => {
    const nextMode = windowState.mode === 'window' ? 'floating' : 'window'
    const nextState = await window.api.setWindowMode(nextMode)
    setWindowState(nextState)
  }, [windowState.mode])

  useEffect(() => {
    if (windowState.mode === 'window' && isPanelPinned) {
      setIsPanelPinned(false)
      return
    }
    window.api.setWindowPinned(isPanelPinned)
    return () => window.api.setWindowPinned(false)
  }, [isPanelPinned, windowState.mode])

  // Reset auto-scroll flag to true when a new message starts generating
  useEffect(() => {
    if (isCurrentSessionGenerating) {
      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
    }
  }, [isCurrentSessionGenerating])

  const updateMessageNavigationState = useCallback((container: HTMLDivElement): void => {
    const messageNodes = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]')
    )
    if (messageNodes.length === 0) {
      setActiveMessageNavId(null)
      return
    }

    const threshold = 60
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    if (isAtBottom) {
      setActiveMessageNavId(messageNodes[messageNodes.length - 1].dataset.messageId || null)
      return
    }

    const containerTop = container.getBoundingClientRect().top
    const targetY = containerTop + Math.min(Math.max(container.clientHeight * 0.28, 120), 240)
    const activeNode =
      messageNodes.find((node) => node.getBoundingClientRect().bottom >= targetY) ||
      messageNodes[0]

    setActiveMessageNavId(activeNode.dataset.messageId || null)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const container = messagesContainerRef.current
    if (!container) return

    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
    setActiveMessageNavId(lastMessage?.id || null)
    isProgrammaticScrollRef.current = true
    container.scrollTo({
      top: container.scrollHeight,
      behavior
    })

    const resetDelay = behavior === 'smooth' ? 500 : 60
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
    }, resetDelay)
  }, [activeSession?.messages])

  const scrollToMessage = useCallback(
    (messageId: string, isLastMessage: boolean): void => {
      if (isLastMessage) {
        scrollToBottom('smooth')
        return
      }

      const container = messagesContainerRef.current
      if (!container) return

      const target = Array.from(
        container.querySelectorAll<HTMLElement>('[data-message-id]')
      ).find((node) => node.dataset.messageId === messageId)
      if (!target) return

      shouldAutoScrollRef.current = false
      setShowScrollToBottom(true)
      setActiveMessageNavId(messageId)
      isProgrammaticScrollRef.current = true
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })

      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
        updateMessageNavigationState(container)
      }, 500)
    },
    [scrollToBottom, updateMessageNavigationState]
  )

  // Auto-scroll when messages update
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
        setActiveMessageNavId(lastMessage?.id || null)
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
          setShowScrollToBottom(false)
          return () => clearTimeout(timeoutId)
        } else {
          container.scrollTop = container.scrollHeight
          setShowScrollToBottom(false)
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
    setActiveMessageNavId(pendingScrollMessageId)
    isProgrammaticScrollRef.current = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const timeoutId = setTimeout(() => {
      isProgrammaticScrollRef.current = false
      setPendingScrollMessageId(null)
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [activeSessionId, activeSession?.messages.length, pendingScrollMessageId])

  // Keep scrolling to the bottom when size of the message list inner content changes during generation (e.g. streaming tokens or expanding tool details)
  useEffect(() => {
    const container = messagesContainerRef.current
    const inner = messagesInnerRef.current
    if (!container || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current && isCurrentSessionGenerating) {
        isProgrammaticScrollRef.current = true
        container.scrollTop = container.scrollHeight
        const messageNodes = Array.from(
          container.querySelectorAll<HTMLElement>('[data-message-id]')
        )
        setActiveMessageNavId(messageNodes[messageNodes.length - 1]?.dataset.messageId || null)
        setTimeout(() => {
          isProgrammaticScrollRef.current = false
        }, 60)
      }
    })

    observer.observe(inner)
    return () => observer.disconnect()
  }, [activeSessionId, isCurrentSessionGenerating])

  // Handle manual scroll detection
  const handleScroll = (): void => {
    const container = messagesContainerRef.current
    if (!container) return

    // If it's a programmatic scroll (like smooth scrolling on load), ignore it
    if (isProgrammaticScrollRef.current) return

    const threshold = 60 // pixels from bottom (higher threshold for high-DPI/zoom tolerance)
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    if (isAtBottom) {
      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
    } else {
      shouldAutoScrollRef.current = false
      setShowScrollToBottom(true)
    }

    updateMessageNavigationState(container)
  }

  // Focus textarea when UI toggles
  useEffect(() => {
    if (!showSettings) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [showSettings, activeSessionId])

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
  const handleInputChange = (val: string): void => {
    inputDraftRef.current = val
    if (val.startsWith('@') || val.startsWith('/') || autocompleteItems.length > 0) {
      setInputVal(val)
      updateAutocompleteItems(val, modelsList, sessions, activeSessionId, providers, skills)
    }
  }

  const getSkillInputTail = (item: AutocompleteItem): string => {
    const currentValue = inputDraftRef.current.trimStart()
    if (item.type === 'skill' && currentValue.startsWith('@')) {
      const firstSpace = currentValue.search(/\s/)
      return firstSpace === -1 ? '' : currentValue.slice(firstSpace).trim()
    }
    return currentValue.toLowerCase().startsWith(item.trigger.toLowerCase())
      ? currentValue.slice(item.trigger.length).trim()
      : ''
  }

  // Action executed on autocomplete item select
  const triggerAutocompleteItem = async (item: AutocompleteItem): Promise<void> => {
    if (!item) return
    if (item.type === 'command') {
      if (item.cmd === 'new') {
        setSessionFamilyRootId(null)
        setDismissedSessionFamilyViewForId(null)
        await handleNewSession({ projectId: activeProject?.id })
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
      inputDraftRef.current = ''
      setInputVal('')
    } else if (item.type === 'delete-session') {
      await handleDeleteSession(item.sessionId || '')
      setAutocompleteItems([])
      inputDraftRef.current = ''
      setInputVal('')
    } else if (item.type === 'session') {
      // Switch conversation session
      enterSessionFamilyView(item.id)
      setActiveSessionId(item.id)
      handleCloseSettings()
      setAutocompleteItems([])
      inputDraftRef.current = ''
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
      inputDraftRef.current = ''
      setInputVal('')
    } else if (item.type === 'provider') {
      // Switch active provider instantly
      await handleSetActiveProvider(item.providerId || '')
      setAutocompleteItems([])
      inputDraftRef.current = ''
      setInputVal('')
    } else {
      // Select a skill mention. The general agent will load the Skill via load_skill.
      setAutocompleteItems([])
      const inputTail = getSkillInputTail(item)
      const nextInput = inputTail ? `${item.trigger} ${inputTail}` : `${item.trigger} `
      inputDraftRef.current = nextInput
      setInputVal(nextInput)
    }
    textareaRef.current?.focus()
  }

  // Keyboard navigation inside prompt input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const handled = autocompleteKeyDown(e, triggerAutocompleteItem, (item) => {
      const nextInput = `${item.trigger} `
      inputDraftRef.current = nextInput
      setInputVal(nextInput)
      setAutocompleteItems([])
    })
    if (handled) return
  }

  // Find pending permission request in the active session
  const getPendingPermission = (): PendingPermission | null => {
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
      | {
          approved: boolean
          scope?: 'prefix' | 'tool'
          prefix?: string
          prefixes?: string[]
          tool?: string
        }
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

  // Check if current active session is a clean "new session" with no message history
  const isNewSessionEmpty = activeSession && activeSession.messages.length === 0
  const activeProviderName = providers.find((p) => p.id === activeProviderId)?.name || 'No provider'
  const activeModelName = selectedModel || 'No model'
  const baseContextTokenEstimate = useMemo(
    () =>
      estimateBaseConversationContextTokens({
        messages: activeSession?.messages || [],
        systemPrompt,
        project: activeProject,
        resources: activeSession?.resources
      }),
    [activeProject, activeSession?.messages, activeSession?.resources, systemPrompt]
  )
  const draftAttachmentTokenEstimate = useMemo(
    () => estimateDraftContextTokens({ attachedFiles }),
    [attachedFiles]
  )
  const contextBaseTokenEstimate = baseContextTokenEstimate + draftAttachmentTokenEstimate
  const contextTokenEstimate = contextBaseTokenEstimate
  const contextLengthLabel = `上下文 ≈ ${formatContextTokenCount(contextTokenEstimate)}`
  const contextLengthTitle = `估算当前对话文本上下文长度：${contextTokenEstimate.toLocaleString()} tokens。包含系统提示、项目/资源摘要、历史消息、当前输入和文本附件；图片附件不按视觉 token 估算。`
  const orderedSessions = [...sessions].sort((a, b) => {
    const aTime = a.lastActiveTime || Number(a.id)
    const bTime = b.lastActiveTime || Number(b.id)
    return bTime - aTime
  })
  const scopedOrderedSessions = activeProject
    ? orderedSessions.filter((session) => session.projectId === activeProject.id)
    : orderedSessions.filter((session) => !session.projectId)
  const visibleSessionEntries = visibleSessionFamilyInfo
    ? visibleSessionFamilyInfo.members.map((familyMember) => ({
        session: familyMember.session,
        familyMember
      }))
    : scopedOrderedSessions.map((session) => ({ session, familyMember: null }))
  const autocompleteGroups = groupAutocompleteItems(autocompleteItems)
  const activeBranchInfo = getBranchDisplayInfo(activeSession?.branchOf, sessions, '源会话')
  const branchChildIndex = buildBranchChildIndex(sessions)

  return (
    <div
      className={`app-container ${theme === 'light' ? 'theme-light' : ''} ${
        windowState.mode === 'window' ? 'window-mode' : 'floating-mode'
      }`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* Draggable Top Dragbar */}
      <AppHeader
        theme={theme}
        toggleTheme={toggleTheme}
        isPanelPinned={isPanelPinned}
        setIsPanelPinned={setIsPanelPinned}
        windowMode={windowState.mode}
        isWindowMaximized={windowState.isMaximized}
        onToggleWindowMode={handleToggleWindowMode}
        onMinimizeWindow={() => window.api.minimizeWindow()}
        onToggleWindowMaximized={() => window.api.toggleWindowMaximized()}
        onCloseWindow={() => window.api.hideWindow()}
        showSettings={showSettings}
        handleCloseSettings={handleCloseSettings}
        handleClearCurrentSession={handleClearCurrentSession}
        setShowSettings={setShowSettings}
        isGenerating={isGenerating}
        providers={providers}
        activeProviderId={activeProviderId}
        selectedModel={selectedModel}
      />

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
          activeSessionId={activeSessionId}
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
          webSearchProvider={webSearchProvider}
          setWebSearchProvider={setWebSearchProvider}
          webSearchApiKey={webSearchApiKey}
          setWebSearchApiKey={setWebSearchApiKey}
        />
      ) : (
        <div className={`chat-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <SessionSidebar
            sessions={sessions}
            projects={projects}
            activeProjectId={activeProject?.id || null}
            projectSessionCounts={projectSessionCounts}
            activeSessionId={activeSessionId}
            isSidebarCollapsed={isSidebarCollapsed}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
            visibleSessionFamilyInfo={visibleSessionFamilyInfo}
            visibleSessionEntries={visibleSessionEntries}
            isGenerating={isGenerating}
            activeProviderName={activeProviderName}
            activeModelName={activeModelName}
            onAddProject={handleAddProject}
            onOpenProject={(projectId) => void openProject(projectId)}
            onOpenFreeConversations={() => void openFreeConversations()}
            onDeleteProject={(projectId) => void handleDeleteProject(projectId)}
            exitSessionFamilyView={exitSessionFamilyView}
            handleNewSession={() => handleNewSession({ projectId: activeProject?.id })}
            handleDeleteSession={handleDeleteSession}
            openSession={openSession}
            setSessionFamilyRootId={setSessionFamilyRootId}
            setDismissedSessionFamilyViewForId={setDismissedSessionFamilyViewForId}
            setAutocompleteItems={setAutocompleteItems as (items: never[]) => void}
          />

          <section className="conversation-panel">
            <div className="conversation-titlebar">
              <div className="conversation-title-main">
                <div className="conversation-title-line">
                  <span className="conversation-title-dot">•</span>
                  <h1>{activeSession?.title || 'New chat'}</h1>
                </div>
                <div className="conversation-title-meta">
                  <span>{activeProviderName}</span>
                  {activeProject && (
                    <span className="conversation-project-context" title={activeProject.path}>
                      {activeProject.name} · {activeProject.path}
                    </span>
                  )}
                  {activeBranchInfo && (
                    <button
                      type="button"
                      className="conversation-source-link"
                      onClick={() => {
                        openSession(
                          activeBranchInfo.sourceSessionId,
                          activeBranchInfo.sourceMessageId
                        )
                      }}
                      disabled={!activeBranchInfo.sourceExists}
                      title={activeBranchInfo.sourceExists ? '打开源对话' : '源对话已不存在'}
                    >
                      <GitBranch size={12} />
                      <span>派生自 {activeBranchInfo.sourceLabel}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
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
                <div
                  ref={messagesInnerRef}
                  className="messages-inner-wrapper"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'inherit',
                    width: '100%',
                    minHeight: '100%'
                  }}
                >
                  {activeSession?.messages.map((msg, idx) => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      idx={idx}
                      branchChildren={
                        branchChildIndex[getBranchSourceKey(activeSessionId, msg.id)] || []
                      }
                      isGenerating={
                        isCurrentSessionGenerating && idx === activeSession.messages.length - 1
                      }
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
              </div>
            )}

            {!isNewSessionEmpty && activeSession?.messages.length ? (
              <nav className="message-minimap" aria-label="消息导航">
                {activeSession.messages.map((msg, idx) => {
                  const isLastMessage = idx === activeSession.messages.length - 1
                  const isActive = activeMessageNavId === msg.id
                  const roleLabel = msg.role === 'user' ? '用户' : '助手'
                  const preview = buildMessageNavPreview(msg.content, msg.files)
                  const tooltipLabel = `${roleLabel} #${idx + 1}`

                  return (
                    <button
                      key={msg.id}
                      type="button"
                      className={`message-minimap-item ${msg.role} ${isActive ? 'active' : ''}`}
                      data-label={tooltipLabel}
                      data-preview={preview}
                      onClick={() => scrollToMessage(msg.id, isLastMessage)}
                      title={`${tooltipLabel}：${preview}`}
                      aria-label={`${tooltipLabel}：${preview}`}
                    />
                  )
                })}
              </nav>
            ) : null}

            {!isNewSessionEmpty && showScrollToBottom && (
              <button
                type="button"
                className="scroll-to-bottom-btn"
                onClick={() => scrollToBottom('smooth')}
                title="滑到底部"
                aria-label="滑到底部"
              >
                <ArrowDown size={15} />
              </button>
            )}

            {pendingUserChoice && (
              <UserChoicePopup request={pendingUserChoice} onRespond={handleUserChoiceResponse} />
            )}

            <ChatInputArea
              autocompleteItems={autocompleteItems}
              autocompleteGroups={autocompleteGroups}
              selectedItemIdx={selectedItemIdx}
              skillsMenuRef={skillsMenuRef}
              triggerAutocompleteItem={triggerAutocompleteItem}
              pendingPermission={pendingPermission}
              selectedOptionIndex={selectedOptionIndex}
              handlePermissionResponse={handlePermissionResponse}
              attachedFiles={attachedFiles}
              handleRemoveFile={handleRemoveFile}
              fileInputRef={fileInputRef}
              handleFileChange={handleFileChange}
              contextBaseTokenEstimate={contextBaseTokenEstimate}
              contextLengthLabel={contextLengthLabel}
              contextLengthTitle={contextLengthTitle}
              textareaRef={textareaRef}
              inputVal={inputVal}
              handleInputChange={handleInputChange}
              handleInputKeyDown={handleInputKeyDown}
              handlePaste={handlePaste}
              runMode={runMode}
              setRunMode={setRunMode}
              isCurrentSessionGenerating={isCurrentSessionGenerating}
              isOtherSessionGenerating={isOtherSessionGenerating}
              handleAbortGeneration={handleAbortGeneration}
              handleSendMessage={handleSendMessage}
            />
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
