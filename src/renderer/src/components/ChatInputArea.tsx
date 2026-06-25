import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AutocompleteItem, RunMode } from '../../../shared/types'
import { FilePreviewList } from './FilePreviewList'
import { PermissionPopup } from './PermissionPopup'
import { ContextPanel } from './ContextPanel'
import { estimateDraftContextTokens } from '../utils/contextLength'
import { buildContextUsageBreakdown } from '../utils/contextDiagnostics'
import type { ContextDiagnosticsSnapshot } from '../utils/contextDiagnostics'
import type { PendingPermission, PermissionResponsePayload } from '../features/chat/permissionTypes'
import { AutocompleteMenu } from './chat-input/AutocompleteMenu'
import { ChatComposer } from './chat-input/ChatComposer'
import type { AttachedFile, AutocompleteGroup } from './chat-input/types'

interface ChatInputAreaProps {
  // Autocomplete
  autocompleteItems: AutocompleteItem[]
  autocompleteGroups: AutocompleteGroup[]
  selectedItemIdx: number
  skillsMenuRef: React.RefObject<HTMLDivElement | null>
  triggerAutocompleteItem: (item: AutocompleteItem) => void

  // Permission
  pendingPermission: PendingPermission | null
  selectedOptionIndex: number
  handlePermissionResponse: (payload: PermissionResponsePayload) => void

  // File attachments
  attachedFiles: AttachedFile[]
  handleRemoveFile: (index: number) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  contextBaseTokenEstimate: number
  contextDiagnostics: ContextDiagnosticsSnapshot

  // Input
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  inputVal: string
  handleInputChange: (value: string) => void
  handleInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void

  // Actions
  runMode: RunMode
  setRunMode: (mode: RunMode) => void
  isCurrentSessionGenerating: boolean
  isOtherSessionGenerating: boolean
  handleAbortGeneration: () => void
  handleSendMessage: (promptOverride?: string) => Promise<boolean>
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  autocompleteItems,
  autocompleteGroups,
  selectedItemIdx,
  skillsMenuRef,
  triggerAutocompleteItem,
  pendingPermission,
  selectedOptionIndex,
  handlePermissionResponse,
  attachedFiles,
  handleRemoveFile,
  fileInputRef,
  handleFileChange,
  contextBaseTokenEstimate,
  contextDiagnostics,
  textareaRef,
  inputVal,
  handleInputChange,
  handleInputKeyDown,
  handlePaste,
  runMode,
  setRunMode,
  isCurrentSessionGenerating,
  isOtherSessionGenerating,
  handleAbortGeneration,
  handleSendMessage
}) => {
  const draftValueRef = useRef(inputVal)
  const contextBaseTokenEstimateRef = useRef(contextBaseTokenEstimate)
  const contextMeterTimerRef = useRef<number | null>(null)
  const [hasDraftContent, setHasDraftContent] = useState(() => inputVal.trim().length > 0)
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false)
  const [contextTokenEstimate, setContextTokenEstimate] = useState(
    () => contextBaseTokenEstimate + estimateDraftContextTokens({ input: inputVal })
  )

  const resizeDraftTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const maxHeight = 180
    const nextHeight = Math.max(48, Math.min(textarea.scrollHeight, maxHeight))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [textareaRef])

  useEffect(() => {
    draftValueRef.current = inputVal
    setHasDraftContent(inputVal.trim().length > 0)
    setContextTokenEstimate(
      contextBaseTokenEstimateRef.current + estimateDraftContextTokens({ input: inputVal })
    )
    if (textareaRef.current && textareaRef.current.value !== inputVal) {
      textareaRef.current.value = inputVal
    }
    resizeDraftTextarea()
  }, [inputVal, resizeDraftTextarea, textareaRef])

  useEffect(() => {
    contextBaseTokenEstimateRef.current = contextBaseTokenEstimate
    setContextTokenEstimate(
      contextBaseTokenEstimate + estimateDraftContextTokens({ input: draftValueRef.current })
    )
  }, [contextBaseTokenEstimate])

  useEffect(() => {
    return () => {
      if (contextMeterTimerRef.current !== null) {
        window.clearTimeout(contextMeterTimerRef.current)
      }
    }
  }, [])

  const updateHasDraftContent = useCallback((value: string) => {
    const next = value.trim().length > 0
    setHasDraftContent((prev) => (prev === next ? prev : next))
  }, [])

  const scheduleContextMeterUpdate = useCallback(() => {
    if (contextMeterTimerRef.current !== null) {
      window.clearTimeout(contextMeterTimerRef.current)
    }
    contextMeterTimerRef.current = window.setTimeout(() => {
      contextMeterTimerRef.current = null
      setContextTokenEstimate(
        contextBaseTokenEstimate + estimateDraftContextTokens({ input: draftValueRef.current })
      )
    }, 250)
  }, [contextBaseTokenEstimate])

  const setDraftDomValue = useCallback(
    (value: string) => {
      draftValueRef.current = value
      if (textareaRef.current && textareaRef.current.value !== value) {
        textareaRef.current.value = value
      }
      resizeDraftTextarea()
      updateHasDraftContent(value)
      setContextTokenEstimate(
        contextBaseTokenEstimate + estimateDraftContextTokens({ input: value })
      )
      handleInputChange(value)
    },
    [
      contextBaseTokenEstimate,
      handleInputChange,
      resizeDraftTextarea,
      textareaRef,
      updateHasDraftContent
    ]
  )
  const draftContextTokenEstimate = Math.max(0, contextTokenEstimate - contextBaseTokenEstimate)
  const contextUsage = buildContextUsageBreakdown({
    draftTokens: draftContextTokenEstimate,
    diagnostics: contextDiagnostics
  })
  const contextUsageLevel: 'ok' | 'warn' | 'danger' =
    contextUsage.totalPercent >= 90 ? 'danger' : contextUsage.totalPercent >= 70 ? 'warn' : 'ok'
  const contextMeterStyle = {
    '--context-progress-angle': `${contextUsage.totalPercent * 3.6}deg`
  } as React.CSSProperties
  const contextMeterLabel = `上下文 ${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.contextWindowTokens.toLocaleString()} tokens`

  const updateDraftValue = useCallback(
    (value: string) => {
      draftValueRef.current = value
      updateHasDraftContent(value)
      resizeDraftTextarea()
      scheduleContextMeterUpdate()
      handleInputChange(value)
    },
    [handleInputChange, resizeDraftTextarea, scheduleContextMeterUpdate, updateHasDraftContent]
  )

  const submitDraft = useCallback(() => {
    const promise = handleSendMessage(draftValueRef.current)
    promise
      .then((sent) => {
        if (!sent) return
        setDraftDomValue('')
      })
      .catch(console.error)
  }, [handleSendMessage, setDraftDomValue])

  const handleLocalKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    handleInputKeyDown(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitDraft()
    }
  }

  const canSend = hasDraftContent || attachedFiles.length > 0

  return (
    <>
      <FilePreviewList attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} />
      {isContextPanelOpen && (
        <ContextPanel
          diagnostics={contextDiagnostics}
          draftTokens={draftContextTokenEstimate}
          attachedFiles={attachedFiles}
          onClose={() => setIsContextPanelOpen(false)}
        />
      )}

      <div className="chat-input-section">
        {autocompleteItems.length > 0 && (
          <AutocompleteMenu
            groups={autocompleteGroups}
            selectedItemIdx={selectedItemIdx}
            skillsMenuRef={skillsMenuRef}
            onTriggerItem={triggerAutocompleteItem}
          />
        )}

        {pendingPermission && (
          <PermissionPopup
            pending={pendingPermission}
            selectedOptionIndex={selectedOptionIndex}
            onResponse={handlePermissionResponse}
          />
        )}

        <ChatComposer
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          contextUsageLevel={contextUsageLevel}
          contextMeterStyle={contextMeterStyle}
          contextMeterLabel={contextMeterLabel}
          onOpenContextPanel={() => setIsContextPanelOpen(true)}
          textareaRef={textareaRef}
          pendingPermission={pendingPermission}
          inputVal={inputVal}
          onChangeDraft={updateDraftValue}
          onKeyDown={handleLocalKeyDown}
          onPaste={handlePaste}
          runMode={runMode}
          setRunMode={setRunMode}
          isCurrentSessionGenerating={isCurrentSessionGenerating}
          isOtherSessionGenerating={isOtherSessionGenerating}
          canSend={canSend}
          handleAbortGeneration={handleAbortGeneration}
          onSubmitDraft={submitDraft}
        />
      </div>
    </>
  )
}
