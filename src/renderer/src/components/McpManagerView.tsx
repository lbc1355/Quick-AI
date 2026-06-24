import React from 'react'
import { Plus } from 'lucide-react'
import { useMcpManager } from '../features/mcp/useMcpManager'
import { McpConfigModal } from './mcp/McpConfigModal'
import { McpServerCard } from './mcp/McpServerCard'

export const McpManagerView: React.FC = () => {
  const {
    configDraftText,
    serverStatuses,
    jsonError,
    isSaving,
    saveMessage,
    expandedServers,
    isConfigEditorOpen,
    setIsConfigEditorOpen,
    handleConfigChange,
    handleSave,
    handleDeleteServer,
    toggleServerExpanded,
    handleAddMcpCard
  } = useMcpManager()

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

          {serverStatuses.map((server) => (
            <McpServerCard
              key={server.name}
              server={server}
              isExpanded={!!expandedServers[server.name]}
              onToggleExpanded={toggleServerExpanded}
              onDeleteServer={(name) => void handleDeleteServer(name)}
            />
          ))}
        </div>
      </div>

      {isConfigEditorOpen && (
        <McpConfigModal
          configDraftText={configDraftText}
          jsonError={jsonError}
          isSaving={isSaving}
          saveMessage={saveMessage}
          onChangeConfig={handleConfigChange}
          onSave={() => void handleSave()}
          onClose={() => setIsConfigEditorOpen(false)}
        />
      )}
    </div>
  )
}
