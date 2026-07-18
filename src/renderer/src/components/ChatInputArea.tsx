import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AutocompleteItem, RunMode, SessionPromptAdmissionMode } from '../../../shared/types'
import { FilePreviewList } from './FilePreviewList'
import { PermissionPopup } from './PermissionPopup'
import { ContextPanel } from './ContextPanel'
import { estimateDraftContextTokens } from '../utils/contextLength'
import { buildContextUsageBreakdown, formatUsagePercent } from '../utils/contextDiagnostics'
import type { ContextDiagnosticsSnapshot, ContextUsageBreakdown } from '../utils/contextDiagnostics'
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
  handleAdmitPrompt: (prompt: string, mode: SessionPromptAdmissionMode) => Promise<boolean>
  onOpenBgShellManager: () => void
}
interface ContextUsagePopoverItem {
  key: string
  label: string
  tokens: number
  className: string
}

const formatCompactTokenCount = (tokens: number): string => {
  const value = Math.max(0, tokens)
  const formatScaled = (divisor: number, suffix: string): string => {
    const scaled = Number((value / divisor).toFixed(1))
    return `${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`
  }

  if (value >= 1_000_000) return formatScaled(1_000_000, 'M')
  if (value >= 1_000) return formatScaled(1_000, 'K')
  return value.toLocaleString()
}

const ContextUsagePopover: React.FC<{
  usage: ContextUsageBreakdown
  items: ContextUsagePopoverItem[]
  onClose: () => void
  onViewReport: () => void
}> = ({ usage, items, onClose, onViewReport }) => {
  const visiblePercent = Math.min(100, Math.max(0, usage.totalPercent))

  return (
    <div className="context-usage-popover" role="dialog" aria-label="Context usage summary">
      <div className="context-usage-popover-header">
        <span className="context-usage-popover-title">Context Usage</span>
        <span className="context-usage-popover-actions">
          <button type="button" className="context-usage-view-report" onClick={onViewReport}>
            View Report
          </button>
          <button
            type="button"
            className="context-usage-popover-close"
            onClick={onClose}
            title="Close"
            aria-label="Close context usage summary"
          >
            <X size={15} />
          </button>
        </span>
      </div>

      <div className="context-usage-popover-summary">
        <span>{formatUsagePercent(usage.totalPercent)} Full</span>
        <span>
          ~{formatCompactTokenCount(usage.totalTokens)} /{' '}
          {formatCompactTokenCount(usage.contextWindowTokens)} Tokens
        </span>
      </div>

      <div className="context-usage-bar" aria-hidden="true">
        <div className="context-usage-bar-fill" style={{ width: `${visiblePercent}%` }}>
          {items.map((item) => (
            <span
              key={item.key}
              className={`context-usage-bar-segment ${item.className}`}
              style={{ flexGrow: Math.max(1, item.tokens) }}
            />
          ))}
        </div>
      </div>

      <div className="context-usage-breakdown">
        {items.map((item) => (
          <div className="context-usage-row" key={item.key}>
            <span className={`context-usage-dot ${item.className}`} />
            <span>{item.label}</span>
            <strong>{formatCompactTokenCount(item.tokens)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
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
  handleSendMessage,
  handleAdmitPrompt,
  onOpenBgShellManager
}) => {
  const draftValueRef = useRef(inputVal)
  const contextBaseTokenEstimateRef = useRef(contextBaseTokenEstimate)
  const contextMeterTimerRef = useRef<number | null>(null)
  const [hasDraftContent, setHasDraftContent] = useState(() => inputVal.trim().length > 0)
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false)
  const [isContextUsagePopoverOpen, setIsContextUsagePopoverOpen] = useState(false)
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

  useEffect(() => {
    if (!isContextUsagePopoverOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsContextUsagePopoverOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isContextUsagePopoverOpen])

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
  const roleTokenTotals = contextDiagnostics.compositionSegments.reduce<Record<string, number>>(
    (totals, segment) => {
      totals[segment.role] = (totals[segment.role] || 0) + segment.tokenEstimate
      return totals
    },
    {}
  )
  const contextUsageItems: ContextUsagePopoverItem[] = [
    {
      key: 'system',
      label: 'System prompt',
      tokens: contextUsage.steeringTokens,
      className: 'usage-system'
    },
    {
      key: 'tool-call',
      label: 'Tool calls',
      tokens: roleTokenTotals.tool_call || 0,
      className: 'usage-tool-call'
    },
    {
      key: 'tool-output',
      label: 'Tool output',
      tokens: roleTokenTotals.tool || 0,
      className: 'usage-tool-output'
    },
    {
      key: 'user',
      label: 'User messages',
      tokens: (roleTokenTotals.user || 0) + draftContextTokenEstimate,
      className: 'usage-user'
    },
    {
      key: 'assistant',
      label: 'Assistant',
      tokens: roleTokenTotals.assistant || 0,
      className: 'usage-assistant'
    },
    {
      key: 'mcp',
      label: 'MCP',
      tokens: contextUsage.mcpToolTokens,
      className: 'usage-mcp'
    }
  ].filter((item) => item.tokens > 0)
  const accountedContextTokens = contextUsageItems.reduce((total, item) => total + item.tokens, 0)
  const otherContextTokens = Math.max(0, contextUsage.totalTokens - accountedContextTokens)
  if (otherContextTokens > 0) {
    contextUsageItems.push({
      key: 'other',
      label: 'Other context',
      tokens: otherContextTokens,
      className: 'usage-other'
    })
  }

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

  const submitDraft = useCallback(
    (admissionMode?: SessionPromptAdmissionMode) => {
      const shouldAdmit = isCurrentSessionGenerating || isOtherSessionGenerating
      const mode =
        admissionMode || (isCurrentSessionGenerating ? ('steer' as const) : ('queue' as const))
      const promise = shouldAdmit
        ? handleAdmitPrompt(draftValueRef.current, mode)
        : handleSendMessage(draftValueRef.current)
      promise
        .then((sent) => {
          if (!sent) return
          setDraftDomValue('')
        })
        .catch(console.error)
    },
    [
      handleAdmitPrompt,
      handleSendMessage,
      isCurrentSessionGenerating,
      isOtherSessionGenerating,
      setDraftDomValue
    ]
  )

  const handleLocalKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    handleInputKeyDown(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitDraft()
    }
  }

  const canSend = hasDraftContent || attachedFiles.length > 0
  const openContextReport = useCallback(() => {
    setIsContextUsagePopoverOpen(false)
    setIsContextPanelOpen(true)
  }, [])

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

        {isContextUsagePopoverOpen && (
          <ContextUsagePopover
            usage={contextUsage}
            items={contextUsageItems}
            onClose={() => setIsContextUsagePopoverOpen(false)}
            onViewReport={openContextReport}
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
          onOpenContextUsage={() => setIsContextUsagePopoverOpen((open) => !open)}
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
          onOpenBgShellManager={onOpenBgShellManager}
        />
      </div>
    </>
  )
}
