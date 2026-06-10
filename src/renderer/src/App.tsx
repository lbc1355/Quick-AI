import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Sparkles, GitBranch, Paperclip } from 'lucide-react'

import { AutocompleteItem, AppSettings } from '../../shared/types'
import { ModelsModal } from './components/ModelsModal'
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

import { AppHeader } from './components/AppHeader'
import { SessionSidebar } from './components/SessionSidebar'
import { TaskPanel } from './components/TaskPanel'
import { ChatInputArea } from './components/ChatInputArea'
import { getPopupOptions, groupAutocompleteItems } from './utils/autocompleteHelpers'

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
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false)
  const [activeTaskMessageId, setActiveTaskMessageId] = useState<string | null>(null)

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

  // Selector to find the latest tasks from the active session
  const currentTasks = useMemo(() => {
    if (!activeSession) return null
    if (activeTaskMessageId) {
      const msg = activeSession.messages.find((m) => m.id === activeTaskMessageId)
      const taskEvent = msg?.agentEvents?.find((e) => e.type === 'task_update')
      if (taskEvent && taskEvent.type === 'task_update') {
        return taskEvent.tasks
      }
    }
    for (let i = activeSession.messages.length - 1; i >= 0; i--) {
      const msg = activeSession.messages[i]
      const taskEvent = msg.agentEvents?.find((e) => e.type === 'task_update')
      if (taskEvent && taskEvent.type === 'task_update') {
        return taskEvent.tasks
      }
    }
    return null
  }, [activeSession, activeTaskMessageId])

  // Track the previous task count to detect when tasks first appear
  const prevTasksLengthRef = useRef(0)
  useEffect(() => {
    const newLength = currentTasks ? currentTasks.length : 0
    if (newLength > 0 && prevTasksLengthRef.current === 0) {
      setIsTaskPanelOpen(true)
    }
    prevTasksLengthRef.current = newLength
  }, [currentTasks])

  // Reset active task message and task panel state when active session changes using render-phase state adjustment
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId)
  if (activeSessionId !== prevSessionId) {
    setPrevSessionId(activeSessionId)
    setActiveTaskMessageId(null)
    setIsTaskPanelOpen(false)
  }

  // Auto-select the active task message when the last message is generating and has tasks
  useEffect(() => {
    if (!activeSession) return
    const lastMsg = activeSession.messages[activeSession.messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      const hasTasks = lastMsg.agentEvents?.some((e) => e.type === 'task_update')
      if (hasTasks) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTaskMessageId(lastMsg.id)
      }
    }
  }, [activeSession, isCurrentSessionGenerating])

  const handleToggleTasks = useCallback(
    (msgId: string) => {
      if (activeTaskMessageId === msgId && isTaskPanelOpen) {
        setIsTaskPanelOpen(false)
      } else {
        setActiveTaskMessageId(msgId)
        setIsTaskPanelOpen(true)
      }
    },
    [activeTaskMessageId, isTaskPanelOpen]
  )
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
      <AppHeader
        theme={theme}
        toggleTheme={toggleTheme}
        isPanelPinned={isPanelPinned}
        setIsPanelPinned={setIsPanelPinned}
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
        />
      ) : (
        <div
          className={`chat-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${
            isTaskPanelOpen ? 'task-panel-open' : ''
          }`}
        >
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            isSidebarCollapsed={isSidebarCollapsed}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
            visibleSessionFamilyInfo={visibleSessionFamilyInfo}
            visibleSessionEntries={visibleSessionEntries}
            isGenerating={isGenerating}
            activeProviderName={activeProviderName}
            activeModelName={activeModelName}
            exitSessionFamilyView={exitSessionFamilyView}
            handleNewSession={handleNewSession}
            handleDeleteSession={handleDeleteSession}
            openSession={openSession}
            setSessionFamilyRootId={setSessionFamilyRootId}
            setDismissedSessionFamilyViewForId={setDismissedSessionFamilyViewForId}
            setAutocompleteItems={setAutocompleteItems as (items: never[]) => void}
          />

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
                    activeTaskMessageId={activeTaskMessageId}
                    isTaskPanelOpen={isTaskPanelOpen}
                    onToggleTasks={handleToggleTasks}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
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

          {activeTaskMessageId && activeSession && (
            (() => {
              const msg = activeSession.messages.find((m) => m.id === activeTaskMessageId)
              return msg ? (
                <TaskPanel
                  message={msg}
                  isOpen={isTaskPanelOpen}
                  onClose={() => setIsTaskPanelOpen(false)}
                />
              ) : null
            })()
          )}
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
