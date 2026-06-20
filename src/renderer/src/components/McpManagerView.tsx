import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Code,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X
} from 'lucide-react'
import { McpServerStatus } from '../../../shared/types'

type McpConfigFile = {
  servers?: Record<string, unknown>
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

function parseMcpConfig(text: string): McpConfigFile {
  return JSON.parse(text) as McpConfigFile
}

const MCP_ADD_TEMPLATE = `{
  "servers": {
    "your-mcp-name": {
      "command": "",
      "args": []
    }
  }
}`

export const McpManagerView: React.FC = () => {
  const [configDraftText, setConfigDraftText] = useState<string>(MCP_ADD_TEMPLATE)
  const [serverStatuses, setServerStatuses] = useState<McpServerStatus[]>([])
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [saveMessage, setSaveMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})
  const [isConfigEditorOpen, setIsConfigEditorOpen] = useState(false)
  const configTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  async function loadData(): Promise<void> {
    try {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to load MCP data:', err)
    }
  }

  async function pollStatus(): Promise<void> {
    try {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to poll MCP status:', err)
    }
  }

  const handleConfigChange = (text: string): void => {
    setConfigDraftText(text)

    try {
      if (text.trim() === '') {
        setJsonError('Config cannot be empty')
        return
      }
      parseMcpConfig(text)
      setJsonError(null)
    } catch (err) {
      setJsonError((err as Error).message)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (jsonError) {
      setSaveMessage({ text: '请先修正 JSON 格式错误', type: 'error' })
      return
    }

    setIsSaving(true)
    setSaveMessage(null)

    try {
      parseMcpConfig(configDraftText)

      await window.api.mcpSetConfig(configDraftText)
      setConfigDraftText(MCP_ADD_TEMPLATE)
      setSaveMessage({ text: '配置已保存并合并，服务重载中...', type: 'success' })

      window.setTimeout(async () => {
        const statuses = await window.api.mcpGetStatus()
        setServerStatuses(statuses)
        setIsSaving(false)
      }, 1500)
    } catch (err) {
      setIsSaving(false)
      setSaveMessage({ text: `保存失败: ${(err as Error).message}`, type: 'error' })
    }
  }

  const handleDeleteServer = async (name: string): Promise<void> => {
    if (!window.confirm(`确定要删除 MCP 服务 "${name}" 吗？`)) {
      return
    }

    setSaveMessage(null)
    setIsSaving(true)

    try {
      const result = await window.api.mcpDeleteServer(name)
      setJsonError(null)

      if (!result.deleted) {
        setIsSaving(false)
        setSaveMessage({ text: '未在配置文件中找到该服务。', type: 'error' })
        return
      }

      setServerStatuses((prev) => prev.filter((server) => server.name !== name))
      setSaveMessage({ text: `服务 "${name}" 已删除，重连中...`, type: 'success' })

      window.setTimeout(async () => {
        const statuses = await window.api.mcpGetStatus()
        setServerStatuses(statuses)
        setIsSaving(false)
      }, 1500)
    } catch (err) {
      setIsSaving(false)
      setSaveMessage({ text: `删除失败: ${(err as Error).message}`, type: 'error' })
    }
  }

  const toggleServerExpanded = (name: string): void => {
    setExpandedServers((prev) => ({
      ...prev,
      [name]: !prev[name]
    }))
  }

  const handleAddMcpCard = (): void => {
    setConfigDraftText(MCP_ADD_TEMPLATE)
    setJsonError(null)
    setSaveMessage(null)
    setIsConfigEditorOpen(true)
  }

  const getStatusIcon = (status: McpServerStatus['status']): React.ReactElement => {
    switch (status) {
      case 'connected':
        return <CheckCircle size={14} className="mcp-icon-success" />
      case 'failed':
        return <AlertCircle size={14} className="mcp-icon-danger" />
      case 'connecting':
        return <RefreshCw size={14} className="mcp-icon-warning spin" />
      default:
        return <Server size={14} className="mcp-icon-muted" />
    }
  }

  const getStatusLabel = (status: McpServerStatus['status']): string => {
    switch (status) {
      case 'connected':
        return '已连接'
      case 'failed':
        return '连接失败'
      case 'connecting':
        return '正在连接'
      case 'disabled':
        return '已禁用'
      default:
        return status
    }
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadData()
    }, 0)

    const timer = window.setInterval(() => {
      void pollStatus()
    }, 5000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!isConfigEditorOpen) return
    const focusTimer = window.setTimeout(() => {
      configTextareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [isConfigEditorOpen])

  return (
    <div className="mcp-layout">
      <div className="mcp-servers-column">
        <span className="settings-label">连接状态 / 服务列表</span>

        <div className="mcp-servers-list">
          <button type="button" className="mcp-server-card mcp-add-card" onClick={handleAddMcpCard}>
            <span className="mcp-add-card-icon">
              <Plus size={18} />
            </span>
            <span className="mcp-add-card-title">添加 MCP</span>
            <span className="mcp-add-card-description">粘贴服务配置后保存连接</span>
          </button>

          {serverStatuses.map((srv) => {
            const isExpanded = !!expandedServers[srv.name]
            return (
              <div
                key={srv.name}
                className={`mcp-server-card ${srv.status} ${isExpanded ? 'expanded' : ''}`}
              >
                <div className="mcp-server-info-row">
                  <div className="mcp-server-name-block">
                    <span className="mcp-server-name" title={srv.name}>
                      {srv.name}
                    </span>
                    <div className={`mcp-status-pill ${srv.status}`}>
                      {getStatusIcon(srv.status)}
                      <span>{getStatusLabel(srv.status)}</span>
                    </div>
                  </div>

                  <div className="mcp-card-actions">
                    {srv.status === 'connected' && srv.tools.length > 0 && (
                      <button
                        type="button"
                        className="mcp-expand-btn"
                        onClick={() => toggleServerExpanded(srv.name)}
                      >
                        <span className="mcp-expand-label">{srv.tools.length} 个工具</span>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mcp-delete-card-btn"
                      title="删除该服务"
                      onClick={() => handleDeleteServer(srv.name)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {srv.status === 'failed' && srv.error && (
                  <div className="mcp-server-error-log">
                    <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{srv.error}</span>
                  </div>
                )}

                {srv.status === 'connected' && isExpanded && srv.tools.length > 0 && (
                  <div className="mcp-server-tools-tree">
                    {srv.tools.map((tool) => (
                      <div key={tool.name} className="mcp-tool-tree-item">
                        <div className="mcp-tool-title-row">
                          <Code size={12} className="mcp-icon-tool" />
                          <code className="mcp-tool-name">
                            mcp_{srv.name}_{tool.name}
                          </code>
                        </div>
                        {tool.description && (
                          <p className="mcp-tool-description">{tool.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {isConfigEditorOpen && (
        <div
          className="modal-backdrop mcp-config-modal-backdrop"
          onMouseDown={() => setIsConfigEditorOpen(false)}
        >
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
              <button
                type="button"
                className="header-action-btn"
                onClick={() => setIsConfigEditorOpen(false)}
                title="关闭"
              >
                <X size={16} />
              </button>
            </header>

            <div className="modal-body mcp-config-modal-body">
              <textarea
                ref={configTextareaRef}
                className={`settings-input mcp-textarea ${jsonError ? 'error' : ''}`}
                placeholder='在此粘贴您的 MCP 服务 JSON 配置（可仅粘贴服务器子节点如 { "arxiv-agent": { ... } }，保存后软件将自动将其合并到配置文件中）'
                value={configDraftText}
                onChange={(event) => handleConfigChange(event.target.value)}
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
              <button
                type="button"
                className="settings-secondary-btn"
                onClick={() => setIsConfigEditorOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-save-btn mcp-save-btn"
                disabled={isSaving || !!jsonError}
                onClick={handleSave}
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
      )}
    </div>
  )
}
