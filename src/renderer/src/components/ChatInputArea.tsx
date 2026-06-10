import React from 'react'
import { Paperclip, Sparkles, Square, Send } from 'lucide-react'
import { AutocompleteItem, RunMode } from '../../../shared/types'
import { FilePreviewList } from './FilePreviewList'
import { PermissionPopup } from './PermissionPopup'
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

  // Input
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  inputVal: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void

  // Actions
  runMode: RunMode
  setRunMode: (mode: RunMode) => void
  isCurrentSessionGenerating: boolean
  isOtherSessionGenerating: boolean
  handleAbortGeneration: () => void
  handleSendMessage: () => void
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
  return (
    <>
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
    </>
  )
}
