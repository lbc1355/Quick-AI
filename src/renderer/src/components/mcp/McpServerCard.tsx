import React from 'react'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Code,
  RefreshCw,
  Server,
  Trash2
} from 'lucide-react'
import type { McpServerStatus } from '../../../../shared/types'

interface McpServerCardProps {
  server: McpServerStatus
  isExpanded: boolean
  onToggleExpanded: (name: string) => void
  onDeleteServer: (name: string) => void
}

function getStatusIcon(status: McpServerStatus['status']): React.ReactElement {
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

function getStatusLabel(status: McpServerStatus['status']): string {
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

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  isExpanded,
  onToggleExpanded,
  onDeleteServer
}) => (
  <div className={`mcp-server-card ${server.status} ${isExpanded ? 'expanded' : ''}`}>
    <div className="mcp-server-info-row">
      <div className="mcp-server-name-block">
        <span className="mcp-server-name" title={server.name}>
          {server.name}
        </span>
        <div className={`mcp-status-pill ${server.status}`}>
          {getStatusIcon(server.status)}
          <span>{getStatusLabel(server.status)}</span>
        </div>
      </div>

      <div className="mcp-card-actions">
        {server.status === 'connected' && server.tools.length > 0 && (
          <button
            type="button"
            className="mcp-expand-btn"
            onClick={() => onToggleExpanded(server.name)}
          >
            <span className="mcp-expand-label">{server.tools.length} 个工具</span>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <button
          type="button"
          className="mcp-delete-card-btn"
          title="删除该服务"
          onClick={() => onDeleteServer(server.name)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>

    {server.status === 'failed' && server.error && (
      <div className="mcp-server-error-log">
        <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{server.error}</span>
      </div>
    )}

    {server.status === 'connected' && isExpanded && server.tools.length > 0 && (
      <div className="mcp-server-tools-tree">
        {server.tools.map((tool) => (
          <div key={tool.name} className="mcp-tool-tree-item">
            <div className="mcp-tool-title-row">
              <Code size={12} className="mcp-icon-tool" />
              <code className="mcp-tool-name">
                mcp_{server.name}_{tool.name}
              </code>
            </div>
            {tool.description && <p className="mcp-tool-description">{tool.description}</p>}
          </div>
        ))}
      </div>
    )}
  </div>
)
