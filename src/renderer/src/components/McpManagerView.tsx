import React, { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { AgentToolInfo } from '../../../shared/types'
import { useSettings } from '../contexts/SettingsContext'
import { useMcpManager } from '../features/mcp/useMcpManager'
import { McpConfigModal } from './mcp/McpConfigModal'
import { McpServerCard } from './mcp/McpServerCard'
import { McpServerDrawer } from './mcp/McpServerDrawer'
import {
  getInitialToolLanguage,
  getToolDisplay,
  type ToolDisplayLanguage
} from './settings/toolDisplay'

export const McpManagerView: React.FC = () => {
  const { permissions, onChangeToolPermission } = useSettings()
  const {
    configDraftText,
    serverStatuses,
    jsonError,
    isSaving,
    reloadingServers,
    saveMessage,
    isConfigEditorOpen,
    setIsConfigEditorOpen,
    handleConfigChange,
    handleSave,
    handleDeleteServer,
    handleReloadServer,
    handleAddMcpCard
  } = useMcpManager()

  const [selectedServerName, setSelectedServerName] = useState<string | null>(null)
  const [agentTools, setAgentTools] = useState<AgentToolInfo[]>([])
  const [toolDisplayLanguage, setToolDisplayLanguage] =
    useState<ToolDisplayLanguage>(getInitialToolLanguage)

  const loadAgentTools = useCallback((): void => {
    window.api
      .listAgentTools()
      .then((tools) => setAgentTools(tools))
      .catch((err) => console.error('Failed to load agent tools for MCP:', err))
  }, [])

  useEffect(() => {
    loadAgentTools()
  }, [loadAgentTools])

  const setToolLanguage = (language: ToolDisplayLanguage): void => {
    setToolDisplayLanguage(language)
    try {
      window.localStorage.setItem('quickai.agentToolLanguage', language)
    } catch {
      // Preference only
    }
  }

  const handleReloadAndRefresh = async (name: string): Promise<void> => {
    await handleReloadServer(name)
    loadAgentTools()
  }

  const selectedServer = selectedServerName
    ? serverStatuses.find((s) => s.name === selectedServerName) || null
    : null

  return (
    <div className="mcp-layout">
      <div className="mcp-servers-column">
        <div className="mcp-servers-header">
          <span className="settings-label">连接状态 / 服务列表</span>
          {saveMessage && !isConfigEditorOpen && (
            <span className={`mcp-save-status ${saveMessage.type}`}>{saveMessage.text}</span>
          )}
        </div>

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
              isReloading={!!reloadingServers[server.name]}
              onSelectServer={(name) => setSelectedServerName(name)}
              onReloadServer={(name) => void handleReloadAndRefresh(name)}
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

      {selectedServer && (
        <McpServerDrawer
          server={selectedServer}
          agentTools={agentTools}
          permissions={permissions}
          isReloading={!!reloadingServers[selectedServer.name]}
          toolDisplayLanguage={toolDisplayLanguage}
          onToolDisplayLanguageChange={setToolLanguage}
          getToolDisplay={getToolDisplay}
          onChangeToolPermission={onChangeToolPermission}
          onReloadServer={(name) => void handleReloadAndRefresh(name)}
          onClose={() => setSelectedServerName(null)}
        />
      )}
    </div>
  )
}
