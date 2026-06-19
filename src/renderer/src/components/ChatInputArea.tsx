import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Sparkles, Square, Send } from 'lucide-react'
import { AutocompleteItem, RunMode } from '../../../shared/types'
import { FilePreviewList } from './FilePreviewList'
import { PermissionPopup } from './PermissionPopup'
import { ContextPanel } from './ContextPanel'
import { estimateDraftContextTokens } from '../utils/contextLength'
import { buildContextUsageBreakdown } from '../utils/contextDiagnostics'
import type { ContextDiagnosticsSnapshot } from '../utils/contextDiagnostics'
import {
  getAutocompleteTitle,
  getAutocompleteDescription,
  getAutocompleteMeta
} from '../utils/autocompleteHelpers'

interface PendingPermission {
  msgId: string
  agentRunId: string
  callId: string
  toolName: string
  args: unknown
}

interface AttachedFile {
  name: string
  content: string
  type: string
}

interface AutocompleteGroup {
  type: AutocompleteItem['type']
  label: string
  items: Array<{ item: AutocompleteItem; index: number }>
}

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
  handlePermissionResponse: (
    payload:
      | boolean
      | { approved: boolean; scope?: 'prefix' | 'tool'; prefix?: string; tool?: string }
  ) => void

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

  useEffect(() => {
    draftValueRef.current = inputVal
    setHasDraftContent(inputVal.trim().length > 0)
    setContextTokenEstimate(
      contextBaseTokenEstimateRef.current + estimateDraftContextTokens({ input: inputVal })
    )
    if (textareaRef.current && textareaRef.current.value !== inputVal) {
      textareaRef.current.value = inputVal
    }
  }, [inputVal, textareaRef])

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
      updateHasDraftContent(value)
      setContextTokenEstimate(
        contextBaseTokenEstimate + estimateDraftContextTokens({ input: value })
      )
      handleInputChange(value)
    },
    [contextBaseTokenEstimate, handleInputChange, textareaRef, updateHasDraftContent]
  )
  const draftContextTokenEstimate = Math.max(0, contextTokenEstimate - contextBaseTokenEstimate)
  const contextUsage = buildContextUsageBreakdown({
    draftTokens: draftContextTokenEstimate,
    diagnostics: contextDiagnostics
  })
  const contextUsageLevel =
    contextUsage.totalPercent >= 90 ? 'danger' : contextUsage.totalPercent >= 70 ? 'warn' : 'ok'
  const contextMeterStyle = {
    '--context-progress-angle': `${contextUsage.totalPercent * 3.6}deg`
  } as React.CSSProperties
  const contextMeterLabel = `上下文 ${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.contextWindowTokens.toLocaleString()} tokens`

  const updateDraftValue = useCallback(
    (value: string) => {
      draftValueRef.current = value
      updateHasDraftContent(value)
      scheduleContextMeterUpdate()
      handleInputChange(value)
    },
    [handleInputChange, scheduleContextMeterUpdate, updateHasDraftContent]
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
                      className={`skills-item skills-item-${item.type} ${
                        selectedItemIdx === itemIndex ? 'selected' : ''
                      }`}
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

        {pendingPermission && (
          <PermissionPopup
            pending={pendingPermission}
            selectedOptionIndex={selectedOptionIndex}
            onResponse={handlePermissionResponse}
          />
        )}

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
          <button
            type="button"
            className={`input-context-meter ${contextUsageLevel}`}
            aria-label="Open context details"
            title={contextMeterLabel}
            onClick={() => setIsContextPanelOpen(true)}
          >
            <span className="context-progress-ring" style={contextMeterStyle} aria-hidden="true" />
          </button>
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={
              pendingPermission
                ? '请先响应上方的工具执行权限请求...'
                : '输入您的问题... (Esc 隐藏, Shift+Enter 换行, / 命令快捷词)'
            }
            defaultValue={pendingPermission ? '' : inputVal}
            onChange={(e) => updateDraftValue(e.target.value)}
            onKeyDown={handleLocalKeyDown}
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
                onClick={submitDraft}
                disabled={isOtherSessionGenerating || !canSend}
                title={isOtherSessionGenerating ? '另一个会话正在生成' : '发送消息'}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
