import React, { useState, useEffect, useRef } from 'react'
import {
  Settings,
  Send,
  Paperclip,
  Terminal,
  Sparkles,
  Trash2,
  Undo2,
  Plus,
  Sun,
  Moon
} from 'lucide-react'

import { AutocompleteItem, AppSettings } from '../../shared/types'
import { getTriggerColor } from './utils/messageFormat'
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

function App(): React.JSX.Element {
  // Navigation
  const [showSettings, setShowSettings] = useState(false)

  // Close settings panel and restore local editor states
  const handleCloseSettings = (): void => {
    setShowSettings(false)
    resetLocalSettings()
  }

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
    resetLocalSettings
  } = useProviders()

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
    checkSessionTimeout
  } = useSessions()

  // Refs for scrolling and textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)

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
    editingMessageId,
    setEditingMessageId,
    editingText,
    setEditingText,
    handleSendMessage,
    handleStartEdit,
    handleSaveEdit,
    handleRegenerate,
    showHelpMessage
  } = useChatCompletion({
    setSessions,
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
  const {
    skills,
    installSkillFromMarkdown,
    removeSkill
  } = useSkills()

  // Listen to window summon (focus/show) event from Main Process
  useEffect(() => {
    const handleWindowShown = (): void => {
      checkSessionTimeout(activeSessionId, sessions)
    }

    // Register event listener
    window.electron.ipcRenderer.on('window-shown', handleWindowShown)
    
    return () => {
      window.electron.ipcRenderer.removeAllListeners('window-shown')
    }
  }, [activeSessionId, sessions, checkSessionTimeout])

  // Reset auto-scroll flag to true when a new message starts generating
  useEffect(() => {
    if (isGenerating) {
      shouldAutoScrollRef.current = true
    }
  }, [isGenerating])

  // Auto-scroll when messages update
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        const behavior = isGenerating ? 'auto' : 'smooth'
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
  }, [sessions, activeSessionId, isGenerating])

  // Handle manual scroll detection
  const handleScroll = (): void => {
    const container = messagesContainerRef.current
    if (!container) return

    // If it's a programmatic scroll (like smooth scrolling on load), ignore it
    if (isProgrammaticScrollRef.current) return

    const threshold = 15 // pixels from bottom
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold
    
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
      if (isGenerating) return

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
  }, [isGenerating, showModelsModal, showAddForm, isEditingProviderDetail, showSettings, setShowModelsModal, setShowAddForm, setIsEditingProviderDetail])

  // Autocomplete change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setInputVal(val)
    updateAutocompleteItems(val, modelsList, sessions, activeSessionId, providers, skills)
  }

  const buildSkillPrompt = (item: AutocompleteItem): string => {
    const prompt = item.prompt || ''
    const currentValue = inputVal.trimStart()
    const inputTail = currentValue.toLowerCase().startsWith(item.trigger.toLowerCase())
      ? currentValue.slice(item.trigger.length).trim()
      : ''

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
      setActiveSessionId(item.id)
      handleCloseSettings()
      setAutocompleteItems([])
      setInputVal('')
    } else if (item.type === 'model') {
      // Switch active model instantly
      setSelectedModel(item.modelId || '')
      
      // Save directly to the storage in background
      const currentSettings = await window.api.storeGet('settings') as AppSettings
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
      const skillPrompt = buildSkillPrompt(item)
      if (item.skillMode === 'send') {
        setInputVal('')
        await handleSendMessage(skillPrompt)
      } else {
        setInputVal(skillPrompt)
      }
    }
    textareaRef.current?.focus()
  }

  // Keyboard navigation inside prompt input
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const handled = autocompleteKeyDown(e, triggerAutocompleteItem)
    if (handled) return

    // Submit prompt on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Check if current active session is a clean "new session" with no message history
  const isNewSessionEmpty = activeSession && activeSession.messages.length === 0

  return (
    <div className={`app-container ${theme === 'light' ? 'theme-light' : ''}`} onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}>
      {/* Draggable Top Dragbar */}
      <div className="drag-header">
        <div className="drag-header-left">
          <Sparkles className="logo-icon" size={16} />
          <span className="logo-text">QuickAI</span>
          <div className="chat-model-info" style={{ marginLeft: '12px' }}>
            <div className={`status-dot ${isGenerating ? 'loading' : ''}`} />
            <span className="model-name" style={{ fontSize: '12px', color: '#9ca3af' }}>
              {providers.find((p) => p.id === activeProviderId)?.name || '未选服务商'}: {selectedModel}
            </span>
          </div>
        </div>
        <div className="drag-header-right">
          <button className="header-action-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {showSettings ? (
            <button className="header-action-btn" onClick={handleCloseSettings} title="返回聊天">
              <Undo2 size={14} />
            </button>
          ) : (
            <>
              <button className="header-action-btn" onClick={() => handleNewSession()} title="新建对话">
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
          onInstallSkill={installSkillFromMarkdown}
          onRemoveSkill={removeSkill}
          onChangeEditingProviderName={(name) => {
            setProviders((prev) => prev.map((p) => (p.id === editingProviderId ? { ...p, name } : p)))
          }}
          onChangeEditingProviderApiUrl={handleApiUrlChange}
        />
      ) : (
        <div className="chat-area">
          {isNewSessionEmpty ? (
            /* Claude Code Style clean watermark interface */
            <div className="empty-state">
              <Sparkles size={40} style={{ color: 'rgba(59, 130, 246, 0.4)', filter: 'drop-shadow(0 0 8px rgba(59,130,246,0.2))' }} />
              <div className="empty-title" style={{ fontSize: '16px', fontWeight: '600', color: 'var(--color-text-title)', marginTop: '14px' }}>
                QuickAI Chat Launcher
              </div>
              <div className="empty-desc" style={{ fontSize: '12.5px', color: '#6b7280', marginTop: '6px', maxWidth: '380px' }}>
                按 Alt+/ 快速显示/隐藏。输入问句直接开始；输入 `/` 可以触发技能或选择加载历史聊天。
              </div>
            </div>
          ) : (
            /* Scrollable Conversation History */
            <div ref={messagesContainerRef} className="messages-container" onScroll={handleScroll}>
              {activeSession?.messages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  idx={idx}
                  isGenerating={isGenerating}
                  editingMessageId={editingMessageId}
                  editingText={editingText}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={() => setEditingMessageId(null)}
                  onSaveEdit={handleSaveEdit}
                  onRegenerate={handleRegenerate}
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
                {autocompleteItems.map((item, idx) => (
                  <div key={item.id} className={`skills-item ${selectedItemIdx === idx ? 'selected' : ''}`} onClick={() => triggerAutocompleteItem(item)}>
                    <span className="skills-trigger" style={{ color: getTriggerColor(item.type) }}>{item.trigger}</span>
                    <span className="skills-name">
                      {item.name.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '').trim()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="input-container">
              <label htmlFor="file-input" className="input-action-btn" title="上传文件 (支持拖拽/粘贴图片)" style={{ cursor: 'pointer' }}>
                <Paperclip size={16} />
                <input ref={fileInputRef} id="file-input" type="file" style={{ display: 'none' }} multiple onChange={handleFileChange} onClick={() => window.api.setFilePickerActive(true)} />
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
