import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Sparkles, GitBranch, Paperclip, ArrowDown } from 'lucide-react'

import { AutocompleteItem, AppSettings, Project, WindowState } from '../../shared/types'
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
  estimateDraftContextTokens,
  estimateHistoryContextTokens,
  estimateSteeringContextTokens
} from './utils/contextLength'
import {
  buildContextCompositionSegments,
  summarizeConversationTokenUsage,
  summarizePromptCacheStats
} from './utils/contextDiagnostics'
import {
  getProviderModelContextWindowInfo,
  getProviderModelRuntimeConfig
} from '../../shared/modelCatalog'

import { AppHeader } from './components/AppHeader'
import { SessionSidebar } from './components/SessionSidebar'
import { ChatInputArea } from './components/ChatInputArea'
import { UserChoicePopup } from './components/UserChoicePopup'
import { getPopupOptions, groupAutocompleteItems } from './utils/autocompleteHelpers'
import { buildMessageNavPreview } from './features/chat/messageNavigation'
import { useMessageNavigation } from './features/chat/useMessageNavigation'
import { useProjectNavigation } from './features/chat/useProjectNavigation'

interface PendingPermission {
  msgId: string
  agentRunId: string
  callId: string
  toolName: string
  args: unknown
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
    modelContextWindows,
    systemPrompt,
    setSystemPrompt,
    autoHideOnBlur,
    setAutoHideOnBlur,
    contextRetentionMode,
    setContextRetentionMode,
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
    refreshingModelContextId,
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
    handleRefreshModelContext,
    handleRemoveModelDirectly,
    handleToggleModelSelection,
    handleChangeModelContextWindow,
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

  const activeProviderConfig = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId),
    [activeProviderId, providers]
  )
  const activeModelRuntimeConfig = useMemo(
    () => getProviderModelRuntimeConfig(activeProviderConfig, selectedModel),
    [activeProviderConfig, selectedModel]
  )
  const activeModelContextWindowTokens =
    activeModelRuntimeConfig?.contextWindowTokens ??
    getProviderModelContextWindowInfo(activeProviderConfig, selectedModel).tokens

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
    sessions,
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
    modelRuntimeConfig: activeModelRuntimeConfig,
    contextWindowTokens: activeModelContextWindowTokens,
    contextRetentionMode,
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
  } = useMessageNavigation({ activeSession, isCurrentSessionGenerating })

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
      const targetSession = sessions.find((session) => session.id === sessionId)
      setSidebarProjectId(targetSession?.projectId ?? null)
      if (messageId) {
        setPendingScrollMessageId(messageId)
      }
      enterSessionFamilyView(sessionId)
      setActiveSessionId(sessionId)
      setAutocompleteItems([])
    },
    [
      enterSessionFamilyView,
      sessions,
      setActiveSessionId,
      setAutocompleteItems,
      setPendingScrollMessageId
    ]
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
  const activeProviderName = activeProviderConfig?.name || 'No provider'
  const activeModelName = selectedModel || 'No model'
  const steeringContextTokenEstimate = useMemo(
    () =>
      estimateSteeringContextTokens({
        systemPrompt,
        project: activeProject,
        resources: activeSession?.resources
      }),
    [activeProject, activeSession?.resources, systemPrompt]
  )
  const historyContextTokenEstimate = useMemo(
    () => estimateHistoryContextTokens(activeSession?.messages || []),
    [activeSession?.messages]
  )
  const draftAttachmentTokenEstimate = useMemo(
    () => estimateDraftContextTokens({ attachedFiles }),
    [attachedFiles]
  )
  const contextBaseTokenEstimate =
    steeringContextTokenEstimate + historyContextTokenEstimate + draftAttachmentTokenEstimate
  const contextWindowInfo = useMemo(
    () => getProviderModelContextWindowInfo(activeProviderConfig, selectedModel),
    [activeProviderConfig, selectedModel]
  )
  const contextWindowTokens = contextWindowInfo.tokens
  const activeProjectLabel = activeProject
    ? `${activeProject.name}${activeProject.path ? ` (${activeProject.path})` : ''}`
    : undefined
  const contextDiagnostics = useMemo(
    () => ({
      cache: summarizePromptCacheStats(activeSession?.messages || []),
      tokenUsage: summarizeConversationTokenUsage(activeSession?.messages || []),
      messageCount: activeSession?.messages.length || 0,
      resourceCount: activeSession?.resources?.length || 0,
      hasSystemPrompt: systemPrompt.trim().length > 0,
      modelName: selectedModel,
      projectLabel: activeProjectLabel,
      customPermissionCount: Object.values(permissions || {}).filter((value) => value !== 'allow')
        .length,
      skillCount: skills.length,
      contextWindowTokens,
      contextWindowSource: contextWindowInfo.source,
      conversationBaseTokens: historyContextTokenEstimate + draftAttachmentTokenEstimate,
      steeringTokens: steeringContextTokenEstimate,
      mcpToolTokens: 0,
      compositionSegments: buildContextCompositionSegments({
        messages: activeSession?.messages || [],
        systemPrompt,
        projectLabel: activeProjectLabel,
        resources: activeSession?.resources
      })
    }),
    [
      activeProjectLabel,
      activeSession?.messages,
      activeSession?.resources,
      contextWindowInfo.source,
      contextWindowTokens,
      draftAttachmentTokenEstimate,
      historyContextTokenEstimate,
      permissions,
      selectedModel,
      skills.length,
      steeringContextTokenEstimate,
      systemPrompt
    ]
  )
  const orderedSessions = [...sessions].sort((a, b) => {
    const aTime = a.lastActiveTime || Number(a.id)
    const bTime = b.lastActiveTime || Number(b.id)
    return bTime - aTime
  })
  const scopedOrderedSessions = sidebarProject
    ? orderedSessions.filter((session) => session.projectId === sidebarProject.id)
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
          modelContextWindows={modelContextWindows}
          manualModelInput={manualModelInput}
          fetchModelsUrl={fetchModelsUrl}
          isFetchingModels={isFetchingModels}
          refreshingModelContextId={refreshingModelContextId}
          showAddForm={showAddForm}
          newProviderName={newProviderName}
          newProviderType={newProviderType}
          systemPrompt={systemPrompt}
          autoHideOnBlur={autoHideOnBlur}
          contextRetentionMode={contextRetentionMode}
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
          setContextRetentionMode={setContextRetentionMode}
          onSaveGlobalSettings={handleSaveGlobalSettings}
          onSaveProviderDetails={handleSaveProviderDetails}
          onAddProvider={handleAddProvider}
          onSetActiveProvider={handleSetActiveProvider}
          onStartEditingProvider={handleStartEditingProvider}
          onDeleteProvider={handleDeleteProvider}
          onAddManualModel={handleAddManualModel}
          onFetchModels={handleFetchModels}
          onRefreshModelContext={handleRefreshModelContext}
          onRemoveModel={handleRemoveModelDirectly}
          onChangeModelContextWindow={handleChangeModelContextWindow}
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
            activeProjectId={sidebarProject?.id || null}
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
            handleNewSession={() => handleNewSession({ projectId: sidebarProject?.id })}
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
