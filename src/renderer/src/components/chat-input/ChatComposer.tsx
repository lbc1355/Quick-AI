import React from 'react'
import { ListPlus, Paperclip, Send, Sparkles, Square, Terminal } from 'lucide-react'
import type { RunMode, SessionPromptAdmissionMode } from '../../../../shared/types'
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
  onSubmitDraft: (mode?: SessionPromptAdmissionMode) => void
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
      <div
        style={{
          gridColumn: '1',
          gridRow: '2',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          alignSelf: 'center'
        }}
      >
        <label
          htmlFor="file-input"
          className="input-action-btn"
          title="上传文件 (支持拖拽/粘贴图片)"
          style={{
            cursor: 'pointer',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
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
          style={{
            cursor: 'pointer',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Terminal size={16} />
        </button>
      </div>
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
          <>
            <button
              className="input-action-btn stop"
              onClick={handleAbortGeneration}
              title="终止回答"
              style={{ color: '#ef4444' }}
            >
              <Square size={14} fill="#ef4444" />
            </button>
            <button
              className="input-action-btn send"
              onClick={() => onSubmitDraft('queue')}
              disabled={!canSend}
              title="排到当前任务之后"
            >
              <ListPlus size={14} />
            </button>
            <button
              className="input-action-btn send"
              onClick={() => onSubmitDraft('steer')}
              disabled={!canSend}
              title="在下一安全边界调整当前 Agent；不支持时自动排队"
            >
              <Send size={14} />
            </button>
          </>
        ) : isOtherSessionGenerating ? (
          <button
            className="input-action-btn send"
            onClick={() => onSubmitDraft('queue')}
            disabled={!canSend}
            title="另一会话正在运行，将消息加入当前会话队列"
          >
            <ListPlus size={14} />
          </button>
        ) : (
          <button
            className="input-action-btn send"
            onClick={() => onSubmitDraft()}
            disabled={!canSend}
            title={isOtherSessionGenerating ? '另一个会话正在生成' : '发送消息'}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
