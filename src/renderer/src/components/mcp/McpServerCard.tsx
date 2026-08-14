import React from 'react'
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  RefreshCw,
  Server,
  Trash2,
  Wrench
} from 'lucide-react'
import type { McpServerStatus } from '../../../../shared/types'

interface McpServerCardProps {
  server: McpServerStatus
  isReloading: boolean
  onSelectServer: (name: string) => void
  onReloadServer: (name: string) => void
  onDeleteServer: (name: string) => void
}

function getStatusIcon(status: McpServerStatus['status']): React.ReactElement {
  switch (status) {
    case 'connected':
      return <CheckCircle size={13} className="mcp-icon-success" />
    case 'failed':
      return <AlertCircle size={13} className="mcp-icon-danger" />
    case 'connecting':
      return <RefreshCw size={13} className="mcp-icon-warning spin" />
    default:
      return <Server size={13} className="mcp-icon-muted" />
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
  isReloading,
  onSelectServer,
  onReloadServer,
  onDeleteServer
}) => (
  <div
    className={`mcp-server-card ${server.status}`}
    onClick={() => onSelectServer(server.name)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelectServer(server.name)
      }
    }}
  >
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

      <div className="mcp-card-actions" onClick={(e) => e.stopPropagation()}>
        {server.status !== 'disabled' && (
          <button
            type="button"
            className="mcp-reload-card-btn"
            title="重新连接该服务"
            disabled={isReloading}
            onClick={() => onReloadServer(server.name)}
          >
            <RefreshCw size={13} className={isReloading ? 'spin' : undefined} />
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

    <div className="mcp-server-footer">
      <div className="mcp-tools-badge">
        <Wrench size={12} />
        <span>{server.tools.length} 个工具</span>
      </div>
      <span className="mcp-card-hint">
        <span>配置与工具</span>
        <ChevronRight size={13} />
      </span>
    </div>
  </div>
)
