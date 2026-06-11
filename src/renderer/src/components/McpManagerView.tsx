import React, { useState, useEffect } from 'react'
import {
  Server,
  AlertCircle,
  CheckCircle,
  Play,
  ChevronDown,
  ChevronRight,
  Code,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { McpServerStatus } from '../../../shared/types'

export const McpManagerView: React.FC = () => {
  const [configText, setConfigText] = useState<string>('{\n  "servers": {}\n}')
  const [serverStatuses, setServerStatuses] = useState<McpServerStatus[]>([])
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [saveMessage, setSaveMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})

  // Load config and statuses on mount
  useEffect(() => {
    loadData()

    // Poll status every 5 seconds
    const timer = setInterval(() => {
      pollStatus()
    }, 5000)

    return () => clearInterval(timer)
  }, [])

  const loadData = async () => {
    try {
      const config = await window.api.mcpGetConfig()
      setConfigText(config)
      
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to load MCP data:', err)
    }
  }

  const pollStatus = async () => {
    try {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to poll MCP status:', err)
    }
  }

  const handleConfigChange = (text: string) => {
    setConfigText(text)
    
    // Dry-run parse JSON to check syntax
    try {
      if (text.trim() === '') {
        setJsonError('Config cannot be empty')
        return
      }
      JSON.parse(text)
      setJsonError(null)
    } catch (err) {
      setJsonError((err as Error).message)
    }
  }

  const handleSave = async () => {
    if (jsonError) {
      setSaveMessage({ text: '请先修正 JSON 格式错误', type: 'error' })
      return
    }

    setIsSaving(true)
    setSaveMessage(null)

    try {
      // Parse to ensure valid JSON is sent
      JSON.parse(configText)

      const mergedConfig = await window.api.mcpSetConfig(configText)
      setConfigText(mergedConfig)
      setSaveMessage({ text: '配置已成功保存并合并，服务重载中...', type: 'success' })
      
      // Wait a moment for server initialization and refresh statuses
      setTimeout(async () => {
        const statuses = await window.api.mcpGetStatus()
        setServerStatuses(statuses)
        setIsSaving(false)
      }, 1500)
    } catch (err) {
      setIsSaving(false)
      setSaveMessage({ text: `保存失败: ${(err as Error).message}`, type: 'error' })
    }
  }

  const handleDeleteServer = async (name: string) => {
    if (!confirm(`确定要删除 MCP 服务器 "${name}" 吗？`)) {
      return
    }

    setSaveMessage(null)
    setIsSaving(true)

    try {
      let currentConfig: any
      try {
        currentConfig = JSON.parse(configText)
      } catch (e) {
        setIsSaving(false)
        setSaveMessage({ text: '删除失败: 无法解析 JSON 语法，请手动在编辑器中删除。', type: 'error' })
        return
      }

      let deleted = false
      if (currentConfig.servers && currentConfig.servers[name]) {
        delete currentConfig.servers[name]
        deleted = true
      }
      if (currentConfig.mcpServers && currentConfig.mcpServers[name]) {
        delete currentConfig.mcpServers[name]
        deleted = true
      }

      if (!deleted) {
        setIsSaving(false)
        setSaveMessage({ text: '未在配置文件中找到该服务。', type: 'error' })
        return
      }

      const newJsonText = JSON.stringify(currentConfig, null, 2)
      setConfigText(newJsonText)
      setJsonError(null)

      const mergedConfig = await window.api.mcpSetConfig(newJsonText)
      setConfigText(mergedConfig)
      setSaveMessage({ text: `服务 "${name}" 已删除，重连中...`, type: 'success' })

      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
      setIsSaving(false)
    } catch (err) {
      setIsSaving(false)
      setSaveMessage({ text: `删除失败: ${(err as Error).message}`, type: 'error' })
    }
  }

  const toggleServerExpanded = (name: string) => {
    setExpandedServers((prev) => ({
      ...prev,
      [name]: !prev[name]
    }))
  }

  const getStatusIcon = (status: McpServerStatus['status']) => {
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

  const getStatusLabel = (status: McpServerStatus['status']) => {
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

  return (
    <div className="mcp-layout">
      {/* Left panel: Config Editor */}
      <div className="mcp-editor-column">
        <div className="mcp-editor-header">
          <span className="settings-label">配置文件 (mcp.json)</span>
        </div>

        <div className="mcp-textarea-wrapper">
          <textarea
            className={`settings-input mcp-textarea ${jsonError ? 'error' : ''}`}
            placeholder="在此粘贴您的 MCP 服务器 JSON 配置（可仅粘贴服务器子节点如 { &quot;arxiv-agent&quot;: { ... } }，保存后软件将自动将其合并到配置文件中）"
            value={configText}
            onChange={(e) => handleConfigChange(e.target.value)}
            spellCheck={false}
          />
        </div>

        {jsonError && (
          <div className="mcp-error-bar">
            <AlertCircle size={13} />
            <span>JSON 语法错误: {jsonError}</span>
          </div>
        )}

        <div className="mcp-footer-actions">
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
          
          {saveMessage && (
            <span className={`mcp-save-status ${saveMessage.type}`}>
              {saveMessage.text}
            </span>
          )}
        </div>
      </div>

      {/* Right panel: Server list & tools */}
      <div className="mcp-servers-column">
        <span className="settings-label">连接状态 / 服务列表</span>
        
        <div className="mcp-servers-list">
          {serverStatuses.length === 0 ? (
            <div className="mcp-empty-state">
              <Server size={24} className="mcp-icon-muted" />
              <p>暂无已配置的服务</p>
              <small>在左侧粘贴 MCP 服务配置对象后保存。</small>
            </div>
          ) : (
            serverStatuses.map((srv) => {
              const isExpanded = !!expandedServers[srv.name]
              return (
                <div key={srv.name} className={`mcp-server-card ${srv.status}`}>
                  <div className="mcp-server-info-row">
                    <div className="mcp-server-name-block">
                      <span className="mcp-server-name" title={srv.name}>{srv.name}</span>
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
                          <span className="mcp-expand-label">
                            {srv.tools.length} 个工具
                          </span>
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
                            <p className="mcp-tool-description">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
