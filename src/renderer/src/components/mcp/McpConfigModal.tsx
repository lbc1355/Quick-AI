import React, { useEffect, useRef } from 'react'
import { AlertCircle, Play, RefreshCw, X } from 'lucide-react'
import type { McpSaveMessage } from '../../features/mcp/useMcpManager'

interface McpConfigModalProps {
  configDraftText: string
  jsonError: string | null
  isSaving: boolean
  saveMessage: McpSaveMessage | null
  onChangeConfig: (text: string) => void
  onSave: () => void
  onClose: () => void
}

export const McpConfigModal: React.FC<McpConfigModalProps> = ({
  configDraftText,
  jsonError,
  isSaving,
  saveMessage,
  onChangeConfig,
  onSave,
  onClose
}) => {
  const configTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      configTextareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [])

  return (
    <div className="modal-backdrop mcp-config-modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-card mcp-config-modal"
        role="dialog"
        aria-modal="true"
        aria-label="添加 MCP 服务"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header mcp-config-modal-header">
          <div className="mcp-config-modal-title-block">
            <span className="modal-title">添加 MCP 服务</span>
            <small>粘贴 MCP JSON 配置，保存后会自动合并并连接。</small>
          </div>
          <button type="button" className="header-action-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="modal-body mcp-config-modal-body">
          <textarea
            ref={configTextareaRef}
            className={`settings-input mcp-textarea ${jsonError ? 'error' : ''}`}
            placeholder='在此粘贴您的 MCP 服务 JSON 配置（可仅粘贴服务器子节点如 { "arxiv-agent": { ... } }，保存后软件将自动将其合并到配置文件中）'
            value={configDraftText}
            onChange={(event) => onChangeConfig(event.target.value)}
            spellCheck={false}
          />

          {jsonError && (
            <div className="mcp-error-bar">
              <AlertCircle size={13} />
              <span>JSON 语法错误: {jsonError}</span>
            </div>
          )}
        </div>

        <footer className="modal-footer mcp-config-modal-footer">
          {saveMessage && (
            <span className={`mcp-save-status ${saveMessage.type}`}>{saveMessage.text}</span>
          )}
          <button type="button" className="settings-secondary-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="settings-save-btn mcp-save-btn"
            disabled={isSaving || !!jsonError}
            onClick={onSave}
          >
            {isSaving ? (
              <>
                <RefreshCw size={13} className="spin" />
                正在保存并合并重连...
              </>
            ) : (
              <>
                <Play size={13} />
                保存并合并连接
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  )
}
