import React, { useState, useEffect, useRef, useCallback, useMemo, useTransition } from 'react'
import { MessageSquare, GitBranch, Paperclip, ArrowDown } from 'lucide-react'

import type {
  AutocompleteItem,
  AppSettings,
  Message,
  Project,
  Session,
  WindowState
} from '../../shared/types'
import { ModelsModal } from './components/ModelsModal'
import { MessageBubble } from './components/MessageBubble'
import { SubagentRunPanel } from './components/SubagentRunPanel'
import { SettingsView } from './components/SettingsView'

import { useSessions } from './hooks/useSessions'
import { useAttachments } from './hooks/useAttachments'
import { useAutocomplete } from './hooks/useAutocomplete'
import { useChatCompletion } from './hooks/useChatCompletion'
import { useUserChoiceRequest } from './hooks/useUserChoiceRequest'
import { useSettings } from './contexts/SettingsContext'

import {
  buildBranchChildIndex,
  getBranchDisplayInfo,
  getBranchSourceKey
} from './utils/branchDisplay'
import { getSessionGenerationState } from './utils/generationState'
import {
  getProviderModelContextWindowInfo,
  getProviderModelRuntimeConfig
} from '../../shared/modelCatalog'
import { getActiveProviderApiKey } from '../../shared/providerKeyHelper'

import { AppHeader } from './components/AppHeader'
import { SessionSidebar } from './components/SessionSidebar'
import { BgShellManagerModal } from './components/BgShellManagerModal'
import { ChatInputArea } from './components/ChatInputArea'
import { StickyUserMessage } from './components/StickyUserMessage'
import { UserChoicePopup } from './components/UserChoicePopup'
import { groupAutocompleteItems } from './utils/autocompleteHelpers'
import { buildMessageNavPreview } from './features/chat/messageNavigation'
import { useMessageNavigation } from './features/chat/useMessageNavigation'
import { useProjectNavigation } from './features/chat/useProjectNavigation'
import { useSessionFamilyView } from './features/chat/useSessionFamilyView'
import { useContextDiagnosticsState } from './features/chat/useContextDiagnosticsState'
import { usePermissionPopupController } from './features/chat/usePermissionPopupController'
import { useVirtualizedMessages, VIRTUAL_MESSAGE_GAP } from './features/chat/useVirtualizedMessages'
import { parseSubagentRuns } from './features/chat/useAgentMessageViewModel'

const EMPTY_MESSAGES: Message[] = []

const buildSessionNavigationSignature = (sessions: Session[]): string =>
  sessions
    .map((session) =>
      [
        session.id,
        session.title,
        session.projectId ?? '',
        session.lastActiveTime ?? '',
        session.messages.length,
        session.branchOf?.sessionId ?? '',
        session.branchOf?.messageId ?? '',
        session.branchOf?.runId ?? ''
      ].join('\u001f')
    )
    .join('\u001e')

const useStableValueBySignature = <T,>(value: T, signature: string): T => {
  const ref = useRef<{ signature: string; value: T } | null>(null)
  if (!ref.current || ref.current.signature !== signature) {
    ref.current = { signature, value }
  }
  return ref.current.value
}

const useStableEvent = <Args extends unknown[], Return>(
  callback: (...args: Args) => Return
): ((...args: Args) => Return) => {
  const ref = useRef(callback)
  ref.current = callback
  return useCallback((...args: Args) => ref.current(...args), [])
}

type MessageMinimapKind = 'user' | 'assistant' | 'agent' | 'error'

const messageMinimapPreviewCache = new WeakMap<Message, string>()

const getMessageMinimapKind = (message: Message): MessageMinimapKind => {
  if (message.isRuntimeError) return 'error'
  if (message.role === 'user') return 'user'
  if (message.agentRunId || (message.agentEvents && message.agentEvents.length > 0)) return 'agent'
  return 'assistant'
}

const getMessageMinimapLabel = (kind: MessageMinimapKind, index: number): string => {
  const label =
    kind === 'user'
      ? 'User'
      : kind === 'assistant'
        ? 'Assistant'
        : kind === 'agent'
          ? 'Agent'
          : 'Error'
  return `${label} #${index + 1}`
}

const getMessageMinimapPreview = (message: Message): string => {
  const cached = messageMinimapPreviewCache.get(message)
  if (cached !== undefined) return cached

  const preview = buildMessageNavPreview(
    message.errorPayload?.message || message.content,
    message.files
  )
  messageMinimapPreviewCache.set(message, preview)
  return preview
}

function App(): React.JSX.Element {
  // Navigation
  const [showSettings, setShowSettings] = useState(false)
  const [showBgShellManager, setShowBgShellManager] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isPanelPinned, setIsPanelPinned] = useState(false)
  const [isSessionSwitching, setIsSessionSwitching] = useState(false)
  const [activeSubagentRoute, setActiveSubagentRoute] = useState<{
    messageId: string
    subagentId: string
  } | null>(null)
  const [isSessionSwitchPending, startSessionSwitchTransition] = useTransition()
  const [windowState, setWindowState] = useState<WindowState>({
    mode: 'window',
    isMaximized: false
  })
  const [projects, setProjects] = useState<Project[]>([])

  // 1. Settings (providers + skills) from context. App only pulls the fields it needs itself for
  // chat, header, autocomplete, the models modal and the ESC handler; the settings UI reads the
  // rest of the ~60 settings fields directly from SettingsContext instead of via prop drilling.
  const {
    setSelectedModel,
    modelsList,
    systemPrompt,
    contextRetentionMode,
    theme,
    toggleTheme,
    providers,
    setProviders,
    activeProviderId,
    isEditingProviderDetail,
    setIsEditingProviderDetail,
    showAddForm,
    setShowAddForm,
    fetchedModels,
    showModelsModal,
    setShowModelsModal,
    handleSetActiveProvider,
    handleToggleModelSelection,
    resetLocalSettings,
    permissions,
    skills
  } = useSettings()

  // Close settings panel and restore local editor states
  const handleCloseSettings = useCallback((): void => {
    setShowSettings(false)
    resetLocalSettings()
  }, [resetLocalSettings])

  const activeProviderConfig = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId),
    [activeProviderId, providers]
  )
  const runningModelName = useMemo(() => activeProviderConfig?.model || '', [activeProviderConfig])
  const runningApiKey = useMemo(
    () => (activeProviderConfig ? getActiveProviderApiKey(activeProviderConfig) : ''),
    [activeProviderConfig]
  )
  const runningApiUrl = useMemo(() => activeProviderConfig?.apiUrl || '', [activeProviderConfig])
  const activeModelRuntimeConfig = useMemo(
    () => getProviderModelRuntimeConfig(activeProviderConfig, runningModelName),
    [activeProviderConfig, runningModelName]
  )
  const activeModelContextWindowTokens =
    activeModelRuntimeConfig?.contextWindowTokens ??
    getProviderModelContextWindowInfo(activeProviderConfig, runningModelName).tokens

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
    syncSessionsRef,
    draftSession,
    setDraftSession
  } = useSessions()
  const [sessionFamilyRootId, setSessionFamilyRootId] = useState<string | null>(null)
  const [dismissedSessionFamilyViewForId, setDismissedSessionFamilyViewForId] = useState<
    string | null
  >(null)
  const sessionSwitchTimerRef = useRef<number | null>(null)
  const switchActiveSessionId = useCallback(
    (sessionId: string): void => {
      if (!sessionId || sessionId === activeSessionId) return

      if (sessionSwitchTimerRef.current !== null) {
        window.clearTimeout(sessionSwitchTimerRef.current)
      }

      setIsSessionSwitching(true)
      setActiveSubagentRoute(null)
      startSessionSwitchTransition(() => {
        setActiveSessionId(sessionId)
      })
      sessionSwitchTimerRef.current = window.setTimeout(() => {
        setIsSessionSwitching(false)
        sessionSwitchTimerRef.current = null
      }, 220)
    },
    [activeSessionId, setActiveSessionId, startSessionSwitchTransition]
  )
  useEffect(
    () => () => {
      if (sessionSwitchTimerRef.current !== null) {
        window.clearTimeout(sessionSwitchTimerRef.current)
      }
    },
    []
  )
  const sessionNavigationSignature = buildSessionNavigationSignature(sessions)
  const navigationSessions = useStableValueBySignature(sessions, sessionNavigationSignature)

  const {
    setSidebarProjectId,
    activeProject,
    sidebarProject,
    projectSessionCounts,
    openProject,
    openFreeConversations,
    handleAddProject,
    handleDeleteProject
  } = useProjectNavigation({
    projects,
    sessions: navigationSessions,
    sessionsRef,
    activeSession,
    activeSessionId,
    setProjects,
    setSessions,
    handleNewSession,
    setSessionFamilyRootId,
    setDismissedSessionFamilyViewForId
  })

  // Refs for textarea and draft input
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputDraftRef = useRef('')

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
    handleCompactCurrentSession,
    handleAbortGeneration
  } = useChatCompletion({
    setSessions,
    setActiveSessionId,
    activeSessionId,
    sessionsRef,
    projects,
    apiKey: runningApiKey,
    apiUrl: runningApiUrl,
    selectedModel: runningModelName,
    modelRuntimeConfig: activeModelRuntimeConfig,
    contextWindowTokens: activeModelContextWindowTokens,
    contextRetentionMode,
    systemPrompt,
    setShowSettings: setShowSettings,
    attachedFiles,
    setAttachedFiles,
    draftSession,
    setDraftSession
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
  const activeMessages = activeSession?.messages ?? EMPTY_MESSAGES
  const activeSubagentRoutePanel = useMemo(() => {
    if (!activeSubagentRoute) return null
    const sourceMessage = activeMessages.find(
      (message) => message.id === activeSubagentRoute.messageId
    )
    if (!sourceMessage) return null
    return (
      parseSubagentRuns(sourceMessage.agentEvents).find(
        (subagent) => subagent.info.subagentId === activeSubagentRoute.subagentId
      ) || null
    )
  }, [activeMessages, activeSubagentRoute])
  useEffect(() => {
    if (activeSubagentRoute && !activeSubagentRoutePanel) {
      setActiveSubagentRoute(null)
    }
  }, [activeSubagentRoute, activeSubagentRoutePanel])
  const getEstimatedMessageTopRef = useRef<((messageId: string) => number | null) | null>(null)
  const getEstimatedMessageTop = useCallback(
    (messageId: string): number | null => getEstimatedMessageTopRef.current?.(messageId) ?? null,
    []
  )
  const {
    messagesEndRef,
    messagesContainerRef,
    messagesInnerRef,
    showScrollToBottom,
    activeMessageNavId,
    setPendingScrollMessageId,
    scrollToBottom,
    scrollToMessage,
    handleScroll
  } = useMessageNavigation({
    activeSession,
    isCurrentSessionGenerating,
    getEstimatedMessageTop
  })
  const virtualizedMessages = useVirtualizedMessages({
    messages: activeMessages,
    containerRef: messagesContainerRef,
    innerRef: messagesInnerRef
  })

  useEffect(() => {
    getEstimatedMessageTopRef.current = virtualizedMessages.getEstimatedMessageTop
  }, [virtualizedMessages.getEstimatedMessageTop])

  // 5. Autocomplete hook
  const {
    autocompleteItems,
    setAutocompleteItems,
    selectedItemIdx,
    skillsMenuRef,
    updateAutocompleteItems,
    handleInputKeyDown: autocompleteKeyDown
  } = useAutocomplete()

  // Reset active task message and task panel state when active session changes using render-phase state adjustment
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId)
  if (activeSessionId !== prevSessionId) {
    setPrevSessionId(activeSessionId)
  }

  const {
    visibleSessionFamilyInfo,
    buildVisibleSessionEntries,
    enterSessionFamilyView,
    exitSessionFamilyView,
    openSession
  } = useSessionFamilyView({
    sessions: navigationSessions,
    activeSessionId,
    sessionFamilyRootId,
    setSessionFamilyRootId,
    dismissedSessionFamilyViewForId,
    setDismissedSessionFamilyViewForId,
    setSidebarProjectId,
    setPendingScrollMessageId,
    setActiveSessionId: switchActiveSessionId,
    setAutocompleteItems
  })
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
      updateAutocompleteItems(
        val,
        modelsList,
        navigationSessions,
        activeSessionId,
        providers,
        skills
      )
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
      } else if (item.cmd === 'compact') {
        await handleCompactCurrentSession()
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
      switchActiveSessionId(item.id)
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

  const { pendingPermission, selectedOptionIndex, handlePermissionResponse } =
    usePermissionPopupController({
      activeSession,
      textareaRef
    })

  // Check if current active session is a clean "new session" with no message history
  const isNewSessionEmpty = activeSession && activeSession.messages.length === 0
  const activeProviderName = activeProviderConfig?.name || 'No provider'
  const { contextBaseTokenEstimate, contextDiagnostics } = useContextDiagnosticsState({
    activeSession: activeSession ?? undefined,
    activeProject,
    activeProviderConfig,
    activeModelRuntimeConfig,
    selectedModel: runningModelName,
    systemPrompt,
    permissions,
    skillsCount: skills.length,
    attachedFiles
  })
  const orderedSessions = useMemo(
    () =>
      [...navigationSessions].sort((a, b) => {
        const aTime = a.lastActiveTime || Number(a.id)
        const bTime = b.lastActiveTime || Number(b.id)
        return bTime - aTime
      }),
    [navigationSessions]
  )
  const scopedOrderedSessions = useMemo(
    () =>
      sidebarProject
        ? orderedSessions.filter((session) => session.projectId === sidebarProject.id)
        : orderedSessions.filter((session) => !session.projectId),
    [orderedSessions, sidebarProject]
  )
  const visibleSessionEntries = useMemo(
    () => buildVisibleSessionEntries(scopedOrderedSessions),
    [buildVisibleSessionEntries, scopedOrderedSessions]
  )
  const autocompleteGroups = groupAutocompleteItems(autocompleteItems)
  const activeBranchInfo = useMemo(
    () => getBranchDisplayInfo(activeSession?.branchOf, navigationSessions, '源会话'),
    [activeSession?.branchOf, navigationSessions]
  )
  const branchChildIndex = useMemo(
    () => buildBranchChildIndex(navigationSessions),
    [navigationSessions]
  )
  const handleOpenProjectFromSidebar = useCallback(
    (projectId: string): void => {
      openProject(projectId)
    },
    [openProject]
  )
  const handleOpenFreeConversationsFromSidebar = useCallback((): void => {
    openFreeConversations()
  }, [openFreeConversations])
  const handleOpenSubagentRoute = useCallback((messageId: string, subagentId: string): void => {
    setActiveSubagentRoute({ messageId, subagentId })
  }, [])
  const handleDeleteProjectFromSidebar = useCallback(
    (projectId: string): void => {
      void handleDeleteProject(projectId)
    },
    [handleDeleteProject]
  )
  const handleNewSessionFromSidebar = useStableEvent(
    (): Promise<Session> => handleNewSession({ projectId: sidebarProject?.id })
  )
  const handleDeleteSessionFromSidebar = useStableEvent(
    (sessionId: string): Promise<void> => handleDeleteSession(sessionId)
  )
  const messageNavItems = useMemo(
    () =>
      activeMessages.map((msg, idx) => {
        const kind = getMessageMinimapKind(msg)
        return {
          msg,
          idx,
          kind,
          label: getMessageMinimapLabel(kind, idx),
          preview: getMessageMinimapPreview(msg)
        }
      }),
    [activeMessages]
  )
  const virtualStickyUserMessageId = useMemo(() => {
    if (!virtualizedMessages.isVirtualized) return undefined

    for (let index = virtualizedMessages.firstVisibleIndex - 1; index >= 0; index -= 1) {
      const message = activeMessages[index]
      if (message?.role === 'user') return message.id
    }

    return null
  }, [activeMessages, virtualizedMessages.firstVisibleIndex, virtualizedMessages.isVirtualized])
  const stickyUserMessages = useMemo(
    () =>
      messageNavItems
        .filter(({ kind }) => kind === 'user')
        .map(({ msg, preview }) => ({
          id: msg.id,
          preview,
          filesCount: msg.files?.length || 0
        })),
    [messageNavItems]
  )
  const showSessionSwitchOverlay = isSessionSwitching || isSessionSwitchPending
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
        selectedModel={runningModelName}
      />

      {/* Main Content Area */}
      {showSettings ? (
        <SettingsView activeSessionId={activeSessionId} />
      ) : (
        <div className={`chat-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <SessionSidebar
            sessions={navigationSessions}
            projects={projects}
            activeProjectId={sidebarProject?.id || null}
            projectSessionCounts={projectSessionCounts}
            activeSessionId={activeSessionId}
            isSidebarCollapsed={isSidebarCollapsed}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
            visibleSessionFamilyInfo={visibleSessionFamilyInfo}
            visibleSessionEntries={visibleSessionEntries}
            isGenerating={isGenerating}
            activeProviderName={activeProviderName}
            activeModelName={runningModelName}
            onAddProject={handleAddProject}
            onOpenProject={handleOpenProjectFromSidebar}
            onOpenFreeConversations={handleOpenFreeConversationsFromSidebar}
            onDeleteProject={handleDeleteProjectFromSidebar}
            exitSessionFamilyView={exitSessionFamilyView}
            handleNewSession={handleNewSessionFromSidebar}
            handleDeleteSession={handleDeleteSessionFromSidebar}
            openSession={openSession}
            setSessionFamilyRootId={setSessionFamilyRootId}
            setDismissedSessionFamilyViewForId={setDismissedSessionFamilyViewForId}
            setAutocompleteItems={setAutocompleteItems as (items: never[]) => void}
          />

          <section
            className={`conversation-panel ${showSessionSwitchOverlay ? 'session-switching' : ''}`}
            aria-busy={showSessionSwitchOverlay}
          >
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
            {showSessionSwitchOverlay && (
              <div className="session-switch-overlay" role="status" aria-label="正在切换对话">
                <div className="session-switch-card">
                  <span className="session-switch-spinner" aria-hidden="true" />
                </div>
              </div>
            )}
            {activeSubagentRoutePanel ? (
              <SubagentRunPanel
                subagent={activeSubagentRoutePanel}
                onClose={() => setActiveSubagentRoute(null)}
              />
            ) : isNewSessionEmpty ? (
              /* Claude Code Style clean watermark interface */
              <div className="empty-state">
                <MessageSquare
                  size={32}
                  style={{
                    color: 'var(--color-text-faint)'
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
                  New conversation
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
                    gap: virtualizedMessages.isVirtualized ? 0 : 'inherit',
                    width: '100%',
                    minHeight: '100%'
                  }}
                >
                  {virtualizedMessages.isVirtualized && virtualizedMessages.topSpacerHeight > 0 && (
                    <div
                      aria-hidden="true"
                      style={{
                        flex: '0 0 auto',
                        height: virtualizedMessages.topSpacerHeight
                      }}
                    />
                  )}
                  {virtualizedMessages.visibleMessages.map(({ message: msg, index: idx }) => (
                    <div
                      key={msg.id}
                      data-virtual-message-id={msg.id}
                      style={{
                        width: '100%',
                        marginBottom:
                          virtualizedMessages.isVirtualized && idx < activeMessages.length - 1
                            ? VIRTUAL_MESSAGE_GAP
                            : undefined
                      }}
                    >
                      <MessageBubble
                        msg={msg}
                        idx={idx}
                        branchChildren={
                          branchChildIndex[getBranchSourceKey(activeSessionId, msg.id)] || []
                        }
                        isGenerating={
                          isCurrentSessionGenerating && idx === activeMessages.length - 1
                        }
                        editingMessageId={editingMessageId}
                        editingText={editingText}
                        onStartEdit={handleStartEdit}
                        onCancelEdit={() => setEditingMessageId(null)}
                        onSaveEdit={handleSaveEdit}
                        onRegenerate={handleRegenerate}
                        onResumeAgentRun={handleResumeAgentRun}
                        onOpenBranch={(sessionId) => openSession(sessionId)}
                        onOpenSubagent={handleOpenSubagentRoute}
                        onChangeEditingText={setEditingText}
                      />
                    </div>
                  ))}
                  {virtualizedMessages.isVirtualized &&
                    virtualizedMessages.bottomSpacerHeight > 0 && (
                      <div
                        aria-hidden="true"
                        style={{
                          flex: '0 0 auto',
                          height: virtualizedMessages.bottomSpacerHeight
                        }}
                      />
                    )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}

            {!activeSubagentRoutePanel && !isNewSessionEmpty && stickyUserMessages.length > 0 && (
              <StickyUserMessage
                containerRef={messagesContainerRef}
                userMessages={stickyUserMessages}
                stickyMessageId={virtualStickyUserMessageId}
                onSelectMessage={scrollToMessage}
              />
            )}

            {!activeSubagentRoutePanel && !isNewSessionEmpty && messageNavItems.length ? (
              <nav className="message-minimap" aria-label="Message navigation">
                {messageNavItems.map(({ msg, kind, label, preview }) => {
                  const isActive = activeMessageNavId === msg.id

                  return (
                    <button
                      key={msg.id}
                      type="button"
                      className={`message-minimap-item ${kind} ${isActive ? 'active' : ''}`}
                      data-label={label}
                      data-preview={preview}
                      onClick={() => scrollToMessage(msg.id)}
                      title={`${label}: ${preview}`}
                      aria-label={`${label}: ${preview}`}
                    />
                  )
                })}
              </nav>
            ) : null}

            {!activeSubagentRoutePanel && !isNewSessionEmpty && showScrollToBottom && (
              <button
                type="button"
                className="scroll-to-bottom-btn"
                onClick={() => scrollToBottom('auto')}
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
              contextDiagnostics={contextDiagnostics}
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
              onOpenBgShellManager={() => setShowBgShellManager(true)}
            />
          </section>
        </div>
      )}

      {/* Background Shell Processes Manager pop-up */}
      {showBgShellManager && (
        <BgShellManagerModal
          sessionId={activeSessionId}
          onClose={() => setShowBgShellManager(false)}
        />
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
