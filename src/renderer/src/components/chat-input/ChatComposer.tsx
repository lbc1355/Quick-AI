import React from 'react'
import { Paperclip, Send, Sparkles, Square, Terminal } from 'lucide-react'
import type { RunMode } from '../../../../shared/types'
import type { PendingPermission } from '../../features/chat/permissionTypes'

interface ChatComposerProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  contextUsageLevel: 'ok' | 'warn' | 'danger'
  contextMeterStyle: React.CSSProperties
  contextMeterLabel: string
  onOpenContextUsage: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingPermission: PendingPermission | null
  inputVal: string
  onChangeDraft: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  runMode: RunMode
  setRunMode: (mode: RunMode) => void
  isCurrentSessionGenerating: boolean
  isOtherSessionGenerating: boolean
  canSend: boolean
  handleAbortGeneration: () => void
  onSubmitDraft: () => void
  onOpenBgShellManager: () => void
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  fileInputRef,
  handleFileChange,
  contextUsageLevel,
  contextMeterStyle,
  contextMeterLabel,
  onOpenContextUsage,
  textareaRef,
  pendingPermission,
  inputVal,
  onChangeDraft,
  onKeyDown,
  onPaste,
  runMode,
  setRunMode,
  isCurrentSessionGenerating,
  isOtherSessionGenerating,
  canSend,
  handleAbortGeneration,
  onSubmitDraft,
  onOpenBgShellManager
}) => {
  return (
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
        className="input-action-btn"
        onClick={onOpenBgShellManager}
        title="后台进程管理"
        style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
      >
        <Terminal size={16} />
      </button>
      <button
        type="button"
        className={`input-context-meter ${contextUsageLevel}`}
        aria-label="Open context usage summary"
        title={contextMeterLabel}
        onClick={onOpenContextUsage}
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
        onChange={(event) => onChangeDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={1}
        disabled={!!pendingPermission}
      />
      <div className="chat-actions">
        <button
          type="button"
          className={`run-mode-btn ${runMode}`}
          onClick={() => setRunMode(runMode === 'chat' ? 'agent' : 'chat')}
          title={
            runMode === 'agent' ? '当前为 Agent 模式 (支持动态工具发现)' : '当前为普通 Chat 模式'
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
            onClick={onSubmitDraft}
            disabled={isOtherSessionGenerating || !canSend}
            title={isOtherSessionGenerating ? '另一个会话正在生成' : '发送消息'}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
